import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
import { createDeepSeekDeltaAssembler, iterateSseEvents } from '../sse.js';
import { BadRequestError, UpstreamError } from '../errors.js';
import { PendingChatSessionStore } from '../storage.js';
import { buildPowResponse } from './challenge.js';
import { stripTrailingSlash } from './defaults.js';
import { UpstreamTraceStore } from './trace-store.js';

const CHAT_COMPLETION_TARGET_PATH = '/api/v0/chat/completion';
const FILE_UPLOAD_TARGET_PATH = '/api/v0/file/upload_file';
const FILE_UPLOAD_PATH = '/file/upload_file';
const CREATE_POW_CHALLENGE_URL = 'https://chat.deepseek.com/api/v0/chat/create_pow_challenge';
const FETCH_CHAT_SESSIONS_PATH = '/chat_session/fetch_page?lte_cursor.pinned=false';
const FETCH_FILES_PATH = '/file/fetch_files';
const FILE_READY_POLL_INTERVAL_MS = 1500;
const FILE_READY_MAX_ATTEMPTS = 15;
const PENDING_FILE_STATUSES = new Set(['PENDING', 'PARSING']);
const SUCCESS_FILE_STATUS = 'SUCCESS';

export class DeepSeekWebClient {
  constructor(
    config,
    {
      fetchImpl = fetch,
      powResponseBuilder = buildPowResponse,
      pendingChatSessionStore = new PendingChatSessionStore(config),
      traceStore = new UpstreamTraceStore({
        maxTraces: config.upstreamTraceLimit,
        maxEventsPerTrace: config.upstreamTraceEventLimit,
        maxTextPreviewChars: config.upstreamTracePreviewChars
      })
    } = {}
  ) {
    this.config = config;
    this.fetch = fetchImpl;
    this.powResponseBuilder = powResponseBuilder;
    this.pendingChatSessionStore = pendingChatSessionStore;
    this.traceStore = traceStore;
  }

  async getAvailability(session) {
    if (!session?.transport?.chatCompletionUrl || !session?.authToken || !session?.cookieHeader) {
      return {
        configured: false,
        reachable: false
      };
    }

    try {
      const response = await this.fetch(CREATE_POW_CHALLENGE_URL, {
        method: 'POST',
        headers: buildHeaders(session),
        body: JSON.stringify({ target_path: CHAT_COMPLETION_TARGET_PATH }),
        signal: createRequestSignal({
          signal: null,
          timeoutMs: this.config.healthTimeoutMs
        })
      });

      return {
        configured: true,
        reachable: response.ok
      };
    } catch {
      return {
        configured: true,
        reachable: false
      };
    }
  }

  async openChatStream({
    session,
    prompt,
    attachments = [],
    thinkingEnabled,
    temperature,
    maxTokens,
    metadata,
    responseFormat,
    signal
  }) {
    const trace = this.traceStore.start({
      endpoint: 'chat_completion',
      prompt_preview: prompt.slice(0, 500),
      thinking_enabled: Boolean(thinkingEnabled),
      metadata_keys: Object.keys(metadata || {}),
      response_format: responseFormat?.type || 'text'
    });
    let chatSessionId = null;
    let cleanup = createCleanupTask(async () => null);

    try {
      chatSessionId = await this.createChatSession(session, { trace, signal });
      cleanup = createCleanupTask(() =>
        this.deleteChatSession(session, chatSessionId, { trace })
      );
      const refFileIds = await this.prepareRefFileIds(session, attachments, {
        trace,
        signal,
        thinkingEnabled
      });
      const powResponse = await this.createPowResponse(session, { trace, signal });
      const headers = buildHeaders(session, {
        'x-ds-pow-response': powResponse
      });
      const payload = {
        chat_session_id: chatSessionId,
        parent_message_id: null,
        prompt,
        ref_file_ids: refFileIds,
        thinking_enabled: thinkingEnabled,
        search_enabled: false,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {})
      };

      this.traceStore.recordStep(trace, {
        type: 'chat_completion_request',
        url: session.transport.chatCompletionUrl,
        payload
      });

      const response = await this.fetch(session.transport.chatCompletionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: createRequestSignal({
          signal,
          timeoutMs: this.config.upstreamTimeoutMs
        })
      });

      if (!response.ok) {
        throw await mapUpstreamError(response, 'DeepSeek chat completion failed.');
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        throw await mapNonStreamUpstreamPayloadError(
          response,
          'DeepSeek chat completion did not return an SSE stream.'
        );
      }

      this.traceStore.recordStep(trace, {
        type: 'chat_completion_response',
        status: response.status,
        content_type: contentType
      });

      return {
        traceId: trace.id,
        chatSessionId,
        cleanup,
        stream: createManagedTextStream(
          createTrackedTextStream(response.body, {
            trace,
            traceStore: this.traceStore
          }),
          { onClose: cleanup }
        ),
        response
      };
    } catch (error) {
      await cleanup();
      this.traceStore.finish(trace, {
        status: 'failed',
        error: serializeError(error)
      });
      throw error;
    }
  }

  async completeChat(options) {
    const { stream, traceId } = await this.openChatStream(options);
    let content = '';

    try {
      for await (const delta of stream) {
        content += delta;
      }

      if (!content.trim()) {
        throw new UpstreamError('DeepSeek completion finished without any assistant content.', {
          statusCode: 502,
          code: 'upstream_empty_completion'
        });
      }

      return {
        content,
        traceId
      };
    } catch (error) {
      throw error;
    }
  }

  async createChatSession(session, { trace, signal }) {
    const response = await this.fetch(session.transport.createChatSessionUrl, {
      method: 'POST',
      headers: buildHeaders(session),
      body: JSON.stringify({ character_id: null }),
      signal: createRequestSignal({
        signal,
        timeoutMs: this.config.upstreamTimeoutMs
      })
    });

    const payload = await parseDeepSeekJsonResponse(
      response,
      'DeepSeek chat session creation failed.'
    );

    const chatSessionId =
      payload?.data?.biz_data?.id ||
      payload?.data?.biz_data?.chat_session?.id ||
      payload?.data?.id ||
      payload?.id;
    if (!chatSessionId) {
      throw new UpstreamError('DeepSeek chat session response did not include a session id.', {
        statusCode: 401,
        code: 'upstream_session_invalid'
      });
    }

    this.traceStore.recordStep(trace, {
      type: 'create_chat_session',
      status: response.status,
      chat_session_id: chatSessionId
    });
    await this.pendingChatSessionStore.add({
      id: chatSessionId,
      created_at: new Date().toISOString(),
      source: 'api'
    });

    return chatSessionId;
  }

  async createPowResponse(
    session,
    {
      trace,
      signal,
      targetPath = CHAT_COMPLETION_TARGET_PATH
    }
  ) {
    const response = await this.fetch(CREATE_POW_CHALLENGE_URL, {
      method: 'POST',
      headers: buildHeaders(session),
      body: JSON.stringify({ target_path: targetPath }),
      signal: createRequestSignal({
        signal,
        timeoutMs: this.config.upstreamTimeoutMs
      })
    });

    const payload = await parseDeepSeekJsonResponse(
      response,
      'DeepSeek PoW challenge request failed.'
    );

    const challenge = payload?.data?.biz_data?.challenge || payload?.data?.challenge || payload?.challenge;
    if (!challenge) {
      throw new UpstreamError('DeepSeek PoW challenge response did not include a challenge payload.', {
        statusCode: 401,
        code: 'upstream_challenge_invalid'
      });
    }

    const powResponse = await this.powResponseBuilder(challenge, targetPath);
    this.traceStore.recordStep(trace, {
      type: 'pow_challenge',
      status: response.status,
      target_path: targetPath,
      difficulty: challenge.difficulty,
      expire_at: challenge.expire_at
    });

    return powResponse;
  }

  async prepareRefFileIds(session, attachments, { trace, signal, thinkingEnabled }) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return [];
    }

    const refFileIds = [];

    for (const attachment of attachments) {
      const resolved = await resolveAttachmentInput(attachment, {
        fetchImpl: this.fetch
      });
      const upload = await this.uploadFile(session, resolved, {
        trace,
        signal,
        thinkingEnabled
      });
      const readyFile = await this.waitForFileReady(session, upload.id, {
        trace,
        signal,
        attachment: resolved
      });

      if (readyFile.status !== SUCCESS_FILE_STATUS) {
        throw new BadRequestError(
          `DeepSeek could not use attachment "${resolved.fileName}" (status: ${readyFile.status}). Images currently rely on DeepSeek Web file extraction, so non-text images may fail unless readable text can be extracted.`,
          {
            file_id: readyFile.id,
            file_name: readyFile.file_name,
            status: readyFile.status,
            error_code: readyFile.error_code || null
          }
        );
      }

      refFileIds.push(upload.id);
    }

    return refFileIds;
  }

  async uploadFile(session, file, { trace, signal, thinkingEnabled }) {
    const powResponse = await this.createPowResponse(session, {
      trace,
      signal,
      targetPath: FILE_UPLOAD_TARGET_PATH
    });
    const { boundary, body } = buildMultipartBody(file);
    const headers = buildHeaders(
      session,
      {
        'x-ds-pow-response': powResponse,
        'x-file-size': String(file.buffer.length),
        'x-thinking-enabled': thinkingEnabled ? '1' : '0',
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length)
      },
      {
        omitContentType: true
      }
    );
    const uploadUrl = `${stripTrailingSlash(session?.transport?.baseUrl || this.config.deepSeekBaseUrl)}${FILE_UPLOAD_PATH}`;

    this.traceStore.recordStep(trace, {
      type: 'upload_file_request',
      url: uploadUrl,
      file_name: file.fileName,
      media_type: file.contentType,
      file_size: file.buffer.length
    });

    const response = await this.fetch(uploadUrl, {
      method: 'POST',
      headers,
      body,
      signal: createRequestSignal({
        signal,
        timeoutMs: this.config.upstreamTimeoutMs
      })
    });
    const payload = await parseDeepSeekJsonResponse(response, 'DeepSeek file upload failed.');
    const uploadedFile = payload?.data?.biz_data || null;

    if (!uploadedFile?.id) {
      throw new UpstreamError('DeepSeek file upload response did not include a file id.', {
        statusCode: 502,
        code: 'upstream_file_upload_invalid'
      });
    }

    this.traceStore.recordStep(trace, {
      type: 'upload_file_response',
      status: response.status,
      file_id: uploadedFile.id,
      file_name: uploadedFile.file_name,
      file_status: uploadedFile.status
    });

    return uploadedFile;
  }

  async waitForFileReady(session, fileId, { trace, signal, attachment }) {
    for (let attempt = 1; attempt <= FILE_READY_MAX_ATTEMPTS; attempt += 1) {
      const file = await this.fetchFileInfo(session, fileId, { signal });
      this.traceStore.recordStep(trace, {
        type: 'file_status',
        attempt,
        file_id: file.id,
        file_name: file.file_name,
        file_status: file.status,
        token_usage: file.token_usage ?? null
      });

      if (!PENDING_FILE_STATUSES.has(file.status)) {
        return file;
      }

      await sleep(FILE_READY_POLL_INTERVAL_MS);
    }

    throw new UpstreamError(`DeepSeek did not finish parsing attachment "${attachment.fileName}" in time.`, {
      statusCode: 504,
      code: 'upstream_file_parse_timeout',
      details: {
        file_name: attachment.fileName,
        file_id: fileId
      }
    });
  }

  async fetchFileInfo(session, fileId, { signal } = {}) {
    const baseUrl = stripTrailingSlash(session?.transport?.baseUrl || this.config.deepSeekBaseUrl);
    const response = await this.fetch(`${baseUrl}${FETCH_FILES_PATH}?file_ids=${encodeURIComponent(fileId)}`, {
      method: 'GET',
      headers: buildHeaders(session, {}, { omitContentType: true }),
      signal: createRequestSignal({
        signal,
        timeoutMs: this.config.upstreamTimeoutMs
      })
    });
    const payload = await parseDeepSeekJsonResponse(
      response,
      'DeepSeek file status fetch failed.'
    );
    const file = payload?.data?.biz_data?.files?.[0];

    if (!file) {
      throw new UpstreamError('DeepSeek file status response did not include the requested file.', {
        statusCode: 502,
        code: 'upstream_file_status_invalid'
      });
    }

    return file;
  }

  async deleteChatSession(session, chatSessionId, { trace } = {}) {
    if (!this.config.deleteChatSessionAfterCompletion || !chatSessionId) {
      return {
        attempted: false,
        deleted: false
      };
    }

    const deleteUrl =
      session?.transport?.deleteChatSessionUrl ||
      `${stripTrailingSlash(session?.transport?.baseUrl || this.config.deepSeekBaseUrl)}/chat_session/delete`;

    try {
      const response = await this.fetch(deleteUrl, {
        method: 'POST',
        headers: buildHeaders(session),
        body: JSON.stringify({ chat_session_id: chatSessionId }),
        signal: createRequestSignal({
          signal: null,
          timeoutMs: this.config.deleteChatSessionTimeoutMs
        })
      });

      const bodyText = await response.text().catch(() => '');
      const payload = parseJson(bodyText);
      const deleted = response.ok && isDeepSeekSuccessPayload(payload);
      if (deleted) {
        await this.pendingChatSessionStore.remove(chatSessionId);
      }

      this.traceStore.recordStep(trace, {
        type: 'delete_chat_session',
        status: response.status,
        chat_session_id: chatSessionId,
        deleted,
        ...(deleted
          ? {}
          : {
              delete_error:
                payload?.msg ||
                payload?.data?.biz_msg ||
                response.statusText ||
                'Unknown delete failure'
            })
      });

      return {
        attempted: true,
        deleted,
        statusCode: response.status
      };
    } catch (error) {
      this.traceStore.recordStep(trace, {
        type: 'delete_chat_session',
        chat_session_id: chatSessionId,
        deleted: false,
        delete_error: error?.message || String(error)
      });

      return {
        attempted: true,
        deleted: false,
        error: error?.message || String(error)
      };
    }
  }

  async listChatSessions(session, { signal } = {}) {
    const baseUrl = stripTrailingSlash(session?.transport?.baseUrl || this.config.deepSeekBaseUrl);
    const response = await this.fetch(`${baseUrl}${FETCH_CHAT_SESSIONS_PATH}`, {
      method: 'GET',
      headers: buildHeaders(session),
      signal: createRequestSignal({
        signal,
        timeoutMs: this.config.upstreamTimeoutMs
      })
    });

    const payload = await parseDeepSeekJsonResponse(
      response,
      'DeepSeek chat session listing failed.'
    );

    const bizData = payload?.data?.biz_data || {};
    return {
      sessions: Array.isArray(bizData.chat_sessions) ? bizData.chat_sessions : [],
      hasMore: Boolean(bizData.has_more)
    };
  }

  async cleanupChatSessions({
    session,
    scope = 'all',
    dryRun = false,
    keepRecent = 0,
    maxDelete = 200
  }) {
    const trackedEntries = await this.pendingChatSessionStore.list();
    const trackedIds = new Set(trackedEntries.map((entry) => entry.id));
    const failures = [];
    const deletedIds = [];
    const skippedIds = [];
    const seenIds = new Set();
    let candidateCount = 0;
    let fetchedCount = 0;
    let passes = 0;
    let hasMore = false;

    if (scope === 'tracked') {
      const candidates = trackedEntries.slice(0, maxDelete);
      candidateCount = candidates.length;

      for (const entry of candidates) {
        if (dryRun) {
          skippedIds.push(entry.id);
          continue;
        }

        const result = await this.deleteChatSession(session, entry.id);
        if (result.deleted) {
          deletedIds.push(entry.id);
          continue;
        }

        failures.push({
          id: entry.id,
          error: result.error || result.statusCode || 'delete_failed'
        });
      }

      return {
        scope,
        dry_run: dryRun,
        keep_recent: 0,
        max_delete: maxDelete,
        fetched_count: trackedEntries.length,
        candidate_count: candidateCount,
        deleted_count: deletedIds.length,
        skipped_count: skippedIds.length,
        failure_count: failures.length,
        failures,
        tracked_remaining_count: (await this.pendingChatSessionStore.list()).length
      };
    }

    while (deletedIds.length + skippedIds.length < maxDelete && passes < 20) {
      passes += 1;
      const page = await this.listChatSessions(session);
      const sessions = page.sessions || [];
      hasMore = page.hasMore;
      fetchedCount += sessions.length;

      if (!sessions.length) {
        break;
      }

      const protectedIds = new Set(sessions.slice(0, keepRecent).map((item) => item.id));
      const candidates = sessions.filter((item) => !protectedIds.has(item.id));
      const uniqueCandidates = candidates.filter((item) => {
        if (seenIds.has(item.id)) {
          return false;
        }

        seenIds.add(item.id);
        return true;
      });

      if (!uniqueCandidates.length) {
        break;
      }

      const batch = uniqueCandidates.slice(0, maxDelete - deletedIds.length - skippedIds.length);
      candidateCount += batch.length;

      for (const item of batch) {
        if (dryRun) {
          skippedIds.push(item.id);
          continue;
        }

        const result = await this.deleteChatSession(session, item.id);
        if (result.deleted) {
          deletedIds.push(item.id);
          continue;
        }

        failures.push({
          id: item.id,
          error: result.error || result.statusCode || 'delete_failed'
        });
      }

      if (dryRun) {
        break;
      }
    }

    return {
      scope,
      dry_run: dryRun,
      keep_recent: keepRecent,
      max_delete: maxDelete,
      fetched_count: fetchedCount,
      candidate_count: candidateCount,
      deleted_count: deletedIds.length,
      skipped_count: skippedIds.length,
      failure_count: failures.length,
      failures,
      has_more: hasMore,
      tracked_remaining_count: (await this.pendingChatSessionStore.list()).length
    };
  }
}

async function* createTrackedTextStream(stream, { trace, traceStore }) {
  const assembleDelta = createDeepSeekDeltaAssembler();
  let content = '';

  try {
    for await (const event of iterateSseEvents(stream)) {
      traceStore.recordSseEvent(trace, event);

      if (event.event === 'toast') {
        throw createStreamEventError(event, {
          fallbackStatusCode: 429,
          fallbackCode: 'upstream_rate_limit',
          fallbackMessage: 'DeepSeek rejected the request because messages were sent too frequently.'
        });
      }

      if (event.event === 'error') {
        throw createStreamEventError(event, {
          fallbackStatusCode: 502,
          fallbackCode: 'upstream_stream_error',
          fallbackMessage: 'DeepSeek returned an upstream stream error event.'
        });
      }

      if (event.event !== 'message') {
        continue;
      }

      if (event.data === '[DONE]') {
        break;
      }

      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }

      const delta = assembleDelta(payload);
      if (!delta) {
        continue;
      }

      content += delta;
      traceStore.appendResponsePreview(trace, delta);
      yield delta;
    }

    traceStore.finish(trace, {
      status: 'completed',
      result: {
        content_preview: truncate(content, 500)
      }
    });
  } catch (error) {
    traceStore.finish(trace, {
      status: 'failed',
      error: serializeError(error),
      result: {
        content_preview: truncate(content, 500)
      }
    });
    throw error;
  }
}

async function* createManagedTextStream(stream, { onClose } = {}) {
  try {
    for await (const chunk of stream) {
      yield chunk;
    }
  } finally {
    void onClose?.();
  }
}

function buildHeaders(session, extraHeaders = {}, { omitContentType = false } = {}) {
  const headers = {
    ...session.transport.headers,
    authorization: session.authToken.startsWith('Bearer ')
      ? session.authToken
      : `Bearer ${session.authToken}`,
    cookie: session.cookieHeader
  };

  if (omitContentType) {
    delete headers['content-type'];
    delete headers['Content-Type'];
  }

  return {
    ...headers,
    ...extraHeaders
  };
}

function createRequestSignal({ signal, timeoutMs }) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }

  return AbortSignal.any([signal, timeoutSignal]);
}

function createCleanupTask(task) {
  let promise = null;

  return () => {
    if (!promise) {
      promise = Promise.resolve().then(task);
    }

    return promise;
  };
}

async function parseDeepSeekJsonResponse(response, fallbackMessage) {
  const text = await response.text().catch(() => '');
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw createUpstreamError({
      response,
      payload,
      bodyText: text,
      fallbackMessage
    });
  }

  const topLevelCode = payload?.code ?? 0;
  const nestedCode = payload?.data?.biz_code ?? 0;
  if (topLevelCode !== 0 || nestedCode !== 0) {
    throw createUpstreamError({
      response,
      payload,
      bodyText: text,
      fallbackMessage
    });
  }

  return payload;
}

async function mapNonStreamUpstreamPayloadError(response, fallbackMessage) {
  const bodyText = await response.text().catch(() => '');
  let payload = null;

  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  return createUpstreamError({
    response,
    payload,
    bodyText,
    fallbackMessage
  });
}

async function mapUpstreamError(response, fallbackMessage) {
  const bodyText = await response.text().catch(() => '');
  let payload = null;

  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  return createUpstreamError({
    response,
    payload,
    bodyText,
    fallbackMessage
  });
}

function createUpstreamError({ response, payload, bodyText, fallbackMessage }) {
  const upstreamCode = payload?.code ?? payload?.data?.biz_code ?? null;
  const upstreamMessage =
    payload?.msg || payload?.data?.biz_msg || payload?.error || response.statusText || fallbackMessage;
  const statusCode = mapUpstreamStatusCode({
    httpStatus: response.status,
    upstreamCode,
    upstreamMessage
  });
  const code = upstreamCode
    ? `upstream_deepseek_${upstreamCode}`
    : `upstream_${response.status}`;

  return new UpstreamError(fallbackMessage, {
    statusCode,
    code,
    details: {
      upstream_status: response.status,
      upstream_code: upstreamCode,
      upstream_message: upstreamMessage,
      body: bodyText || null
    }
  });
}

function mapUpstreamStatusCode({ httpStatus, upstreamCode, upstreamMessage }) {
  if (httpStatus >= 500) {
    return 502;
  }

  if (httpStatus >= 400) {
    return httpStatus;
  }

  if (upstreamCode === 40300 || /MISSING_HEADER/u.test(upstreamMessage || '')) {
    return 403;
  }

  if (String(upstreamCode || '').startsWith('401') || /TOKEN|AUTH|LOGIN/u.test(upstreamMessage || '')) {
    return 401;
  }

  if (String(upstreamCode || '').startsWith('429')) {
    return 429;
  }

  return 502;
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code || null,
    statusCode: error?.statusCode || null
  };
}

function createStreamEventError(event, { fallbackStatusCode, fallbackCode, fallbackMessage }) {
  let payload = null;

  try {
    payload = event.data ? JSON.parse(event.data) : null;
  } catch {
    payload = null;
  }

  const upstreamMessage = payload?.content || payload?.message || fallbackMessage;
  const finishReason = payload?.finish_reason || null;
  const statusCode =
    finishReason === 'rate_limit_reached' ? 429 : fallbackStatusCode;
  const code =
    finishReason === 'rate_limit_reached'
      ? 'upstream_rate_limit'
      : fallbackCode;

  return new UpstreamError(upstreamMessage, {
    statusCode,
    code,
    details: {
      upstream_event: event.event,
      finish_reason: finishReason,
      upstream_message: upstreamMessage,
      body: event.data || null
    }
  });
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function isDeepSeekSuccessPayload(payload) {
  if (!payload) {
    return true;
  }

  return (payload.code ?? 0) === 0 && (payload.data?.biz_code ?? 0) === 0;
}

function buildMultipartBody(file) {
  const boundary = `----NodeFormBoundary${crypto.randomBytes(12).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeMultipartValue(file.fileName)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    boundary,
    body: Buffer.concat([head, file.buffer, tail])
  };
}

async function resolveAttachmentInput(attachment, { fetchImpl }) {
  if (attachment.source_type === 'data_url') {
    return resolveDataUrlAttachment(attachment);
  }

  if (attachment.source_type === 'base64') {
    return resolveBase64Attachment(attachment);
  }

  if (attachment.source_type === 'path') {
    return resolvePathAttachment(attachment);
  }

  return resolveRemoteAttachment(attachment, { fetchImpl });
}

function resolveDataUrlAttachment(attachment) {
  const match = String(attachment.source || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/isu);
  if (!match) {
    throw new BadRequestError(`Attachment "${attachment.file_name || 'attachment'}" is not a valid data URL.`);
  }

  const mediaType = attachment.media_type || match[1] || inferContentType(attachment.file_name, attachment.kind);
  return {
    fileName: attachment.file_name || defaultFileName(attachment.kind, mediaType),
    contentType: mediaType,
    buffer: Buffer.from(match[2], 'base64')
  };
}

function resolveBase64Attachment(attachment) {
  const mediaType = attachment.media_type || inferContentType(attachment.file_name, attachment.kind);
  return {
    fileName: attachment.file_name || defaultFileName(attachment.kind, mediaType),
    contentType: mediaType,
    buffer: Buffer.from(String(attachment.source || ''), 'base64')
  };
}

async function resolvePathAttachment(attachment) {
  const rawPath = attachment.source_type === 'path' ? attachment.source : attachment.file_name;
  const localPath =
    rawPath instanceof URL
      ? rawPath
      : String(rawPath).startsWith('file://')
        ? new URL(rawPath)
        : rawPath;
  const buffer = await fs.readFile(localPath);
  const fileName =
    attachment.file_name ||
    path.basename(typeof localPath === 'string' ? localPath : localPath.pathname) ||
    defaultFileName(attachment.kind, attachment.media_type);

  return {
    fileName,
    contentType: attachment.media_type || inferContentType(fileName, attachment.kind),
    buffer
  };
}

async function resolveRemoteAttachment(attachment, { fetchImpl }) {
  if (/^file:\/\//iu.test(String(attachment.source || ''))) {
    return resolvePathAttachment({
      ...attachment,
      source_type: 'path',
      source: new URL(attachment.source)
    });
  }

  const response = await fetchImpl(attachment.source, {
    method: 'GET',
    signal: createRequestSignal({
      signal: null,
      timeoutMs: 20_000
    })
  });

  if (!response.ok) {
    throw new BadRequestError(
      `Failed to fetch attachment "${attachment.file_name || attachment.source}" (${response.status} ${response.statusText}).`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType =
    attachment.media_type ||
    normalizeContentTypeHeader(response.headers.get('content-type')) ||
    inferContentType(attachment.file_name, attachment.kind);

  return {
    fileName: attachment.file_name || deriveFileNameFromUrl(attachment.source, attachment.kind),
    contentType,
    buffer: Buffer.from(arrayBuffer)
  };
}

function inferContentType(fileName, kind) {
  const normalized = String(fileName || '').toLowerCase();
  const mapping = [
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.gif', 'image/gif'],
    ['.svg', 'image/svg+xml'],
    ['.pdf', 'application/pdf'],
    ['.json', 'application/json'],
    ['.md', 'text/markdown'],
    ['.csv', 'text/csv'],
    ['.txt', 'text/plain']
  ];

  for (const [extension, contentType] of mapping) {
    if (normalized.endsWith(extension)) {
      return contentType;
    }
  }

  return kind === 'image' ? 'image/png' : 'application/octet-stream';
}

function normalizeContentTypeHeader(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function deriveFileNameFromUrl(value, kind) {
  try {
    const url = new URL(value);
    const fromPath = url.pathname.split('/').filter(Boolean).pop();
    if (fromPath) {
      return fromPath;
    }
  } catch {}

  return defaultFileName(kind);
}

function defaultFileName(kind, mediaType = '') {
  const extension = extensionFromContentType(mediaType);
  const base = kind === 'image' ? 'image' : 'attachment';
  return extension ? `${base}.${extension}` : base;
}

function extensionFromContentType(mediaType) {
  const mapping = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
    ['image/svg+xml', 'svg'],
    ['application/pdf', 'pdf'],
    ['application/json', 'json'],
    ['text/plain', 'txt'],
    ['text/markdown', 'md'],
    ['text/csv', 'csv']
  ]);

  return mapping.get(String(mediaType || '').toLowerCase()) || '';
}

function escapeMultipartValue(value) {
  return String(value || 'file').replace(/"/gu, '%22');
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
