import { fetch } from 'undici';
import { createDeepSeekDeltaAssembler, iterateSseEvents } from '../sse.js';
import { UpstreamError } from '../errors.js';
import { buildPowResponse } from './challenge.js';
import { UpstreamTraceStore } from './trace-store.js';

const CHAT_COMPLETION_TARGET_PATH = '/api/v0/chat/completion';
const CREATE_POW_CHALLENGE_URL = 'https://chat.deepseek.com/api/v0/chat/create_pow_challenge';

export class DeepSeekWebClient {
  constructor(
    config,
    {
      fetchImpl = fetch,
      powResponseBuilder = buildPowResponse,
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

    try {
      const chatSessionId = await this.createChatSession(session, { trace, signal });
      const powResponse = await this.createPowResponse(session, { trace, signal });
      const headers = buildHeaders(session, {
        'x-ds-pow-response': powResponse
      });
      const payload = {
        chat_session_id: chatSessionId,
        parent_message_id: null,
        prompt,
        ref_file_ids: [],
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
        stream: createTrackedTextStream(response.body, {
          trace,
          traceStore: this.traceStore
        }),
        response
      };
    } catch (error) {
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

    const chatSessionId = payload?.data?.biz_data?.id || payload?.data?.id || payload?.id;
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

    return chatSessionId;
  }

  async createPowResponse(session, { trace, signal }) {
    const response = await this.fetch(CREATE_POW_CHALLENGE_URL, {
      method: 'POST',
      headers: buildHeaders(session),
      body: JSON.stringify({ target_path: CHAT_COMPLETION_TARGET_PATH }),
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

    const powResponse = await this.powResponseBuilder(challenge, CHAT_COMPLETION_TARGET_PATH);
    this.traceStore.recordStep(trace, {
      type: 'pow_challenge',
      status: response.status,
      difficulty: challenge.difficulty,
      expire_at: challenge.expire_at
    });

    return powResponse;
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

function buildHeaders(session, extraHeaders = {}) {
  return {
    ...session.transport.headers,
    authorization: session.authToken.startsWith('Bearer ')
      ? session.authToken
      : `Bearer ${session.authToken}`,
    cookie: session.cookieHeader,
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
