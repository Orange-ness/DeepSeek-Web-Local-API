import { AsyncSemaphore } from './queue.js';
import { AuthenticationRequiredError, UpstreamError } from './errors.js';
import {
  flattenMessagesToPrompt,
  parseCleanupSessions,
  parseAutoLogin,
  parseChatCompletionRequest,
  parsePasswordLogin,
  resolveModel,
  PUBLIC_MODELS
} from './models.js';
import { createChatCompletionChunk, createChatCompletionId, createChatCompletionResponse } from './openai.js';
import { MetricsStore } from './metrics.js';

export class DeepSeekApiService {
  constructor({
    config,
    sessionManager,
    client,
    queue = new AsyncSemaphore({
      limit: config.upstreamConcurrency,
      queueTimeoutMs: config.queueTimeoutMs,
      maxQueueSize: config.maxQueueSize
    }),
    metrics = new MetricsStore()
  }) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.client = client;
    this.queue = queue;
    this.metrics = metrics;
  }

  async getHealth() {
    const session = await this.sessionManager.getStatus();
    const rawSession = await this.sessionManager.store.load();
    const upstream = await this.client.getAvailability(rawSession);

    return {
      ok: true,
      server_time: new Date().toISOString(),
      deepseek_session: session,
      upstream
    };
  }

  async getAuthStatus() {
    return this.sessionManager.getStatus();
  }

  async getAuthDebug() {
    return this.sessionManager.getDebugInfo();
  }

  async loginWithBrowser() {
    this.metrics.recordAuthAttempt({ strategy: 'browser' });

    try {
      const result = await this.sessionManager.loginWithBrowser();
      this.metrics.recordAuthSuccess({ mode: result.last_login_mode || 'browser' });
      return result;
    } catch (error) {
      this.metrics.recordAuthFailure(error);
      throw error;
    }
  }

  async loginWithPassword(payload) {
    this.metrics.recordAuthAttempt({ strategy: 'password' });

    try {
      const credentials =
        payload && Object.keys(payload).length > 0
          ? parsePasswordLogin(payload)
          : undefined;
      const result = await this.sessionManager.loginWithPassword(credentials);
      this.metrics.recordAuthSuccess({
        mode: result.last_login_mode || 'password',
        usedBrowserFallback: result.last_login_mode === 'password+browser-fallback'
      });
      return result;
    } catch (error) {
      this.metrics.recordAuthFailure(error);
      throw error;
    }
  }

  async loginAuto(payload) {
    const parsed = parseAutoLogin(payload);
    this.metrics.recordAuthAttempt({ strategy: 'auto' });

    try {
      const result = await this.sessionManager.loginAuto({
        email: parsed.email,
        password: parsed.password,
        force: parsed.force,
        preferBrowser: parsed.prefer_browser,
        browserFallback: parsed.browser_fallback
      });

      this.metrics.recordAuthSuccess({
        mode: result.last_login_mode || result.strategy || 'auto',
        usedBrowserFallback: result.strategy === 'password+browser-fallback'
      });
      return result;
    } catch (error) {
      this.metrics.recordAuthFailure(error);
      throw error;
    }
  }

  async logout() {
    return this.sessionManager.logout();
  }

  async cleanupSessions(payload = {}) {
    const parsed = parseCleanupSessions(payload);
    const session = await this.ensureAuthenticated({ allowAutoLogin: true });

    return this.queue.run(() =>
      this.client.cleanupChatSessions({
        session,
        scope: parsed.scope,
        dryRun: parsed.dry_run,
        keepRecent: parsed.keep_recent,
        maxDelete: parsed.max_delete
      })
    );
  }

  async cleanupTrackedStartupSessions() {
    let session;

    try {
      session = await this.sessionManager.requireSession();
    } catch {
      if (!this.sessionManager.hasConfiguredCredentials?.()) {
        return {
          scope: 'tracked',
          skipped: true,
          reason: 'no_usable_session'
        };
      }

      try {
        await this.sessionManager.loginAuto({
          force: true,
          browserFallback: false
        });
        session = await this.sessionManager.requireSession();
      } catch {
        return {
          scope: 'tracked',
          skipped: true,
          reason: 'startup_login_failed'
        };
      }
    }

    return this.queue.run(() =>
      this.client.cleanupChatSessions({
        session,
        scope: 'tracked',
        dryRun: false,
        keepRecent: 0,
        maxDelete: 200
      })
    );
  }

  async getMetrics() {
    return this.metrics.snapshot({
      queue: this.queue,
      traceStore: this.client.traceStore
    });
  }

  async getLatestUpstreamTrace() {
    return this.client.traceStore.getLatest();
  }

  async getUpstreamTraceById(id) {
    return this.client.traceStore.getById(id);
  }

  listModels() {
    return {
      object: 'list',
      data: PUBLIC_MODELS
    };
  }

  parseChatRequest(payload) {
    const request = parseChatCompletionRequest(payload);
    const model = resolveModel(request.model);

    return {
      request,
      model
    };
  }

  async createCompletion(payload, { signal } = {}) {
    const { request, model } = this.parseChatRequest(payload);
    const prompt = flattenMessagesToPrompt(request.messages, {
      responseFormat: request.response_format
    });
    const id = createChatCompletionId();

    const result = await this.runChatOperation({
      request,
      model,
      signal,
      stream: false,
      execute: ({ session }) =>
        this.client.completeChat({
          session,
          prompt,
          thinkingEnabled: model.thinkingEnabled,
          temperature: request.temperature,
          maxTokens: request.max_tokens,
          metadata: request.metadata,
          responseFormat: request.response_format,
          signal
        })
    });

    this.metrics.recordChatRequest({
      model: model.publicModel,
      stream: false,
      traceId: result.traceId
    });

    const response = createChatCompletionResponse({
      id,
      model: model.publicModel,
      content: result.content
    });

    if (request.debug_upstream) {
      response._debug = {
        upstream_trace_id: result.traceId,
        attempts: result.attempts,
        refreshed_session: result.refreshedSession
      };
    }

    return response;
  }

  async startStreamingCompletion(payload, { signal } = {}) {
    const { request, model } = this.parseChatRequest(payload);
    const prompt = flattenMessagesToPrompt(request.messages, {
      responseFormat: request.response_format
    });
    const id = createChatCompletionId();
    const release = await this.queue.acquire({ signal });

    try {
      const result = await this.runChatOperation({
        request,
        model,
        signal,
        stream: true,
        skipQueue: true,
        execute: async ({ session }) => {
          const openResult = await this.client.openChatStream({
            session,
            prompt,
            thinkingEnabled: model.thinkingEnabled,
            temperature: request.temperature,
            maxTokens: request.max_tokens,
            metadata: request.metadata,
            responseFormat: request.response_format,
            signal
          });

          return {
            ...openResult,
            ...(await primeStream(openResult.stream))
          };
        }
      });

      this.metrics.recordChatRequest({
        model: model.publicModel,
        stream: true,
        traceId: result.traceId
      });

      return {
        id,
        model: model.publicModel,
        stream: result.stream,
        firstDelta: result.firstDelta,
        release,
        traceId: result.traceId,
        attempts: result.attempts,
        refreshedSession: result.refreshedSession,
        debugUpstream: request.debug_upstream
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  initialChunk({ id, model }) {
    return createChatCompletionChunk({
      id,
      model,
      delta: '',
      includeRole: true
    });
  }

  contentChunk({ id, model, delta }) {
    return createChatCompletionChunk({
      id,
      model,
      delta
    });
  }

  finalChunk({ id, model }) {
    return createChatCompletionChunk({
      id,
      model,
      done: true
    });
  }

  async runChatOperation({ request, model, signal, stream, execute, skipQueue = false }) {
    let attempts = 0;
    let refreshedSession = false;
    let lastError = null;

    while (attempts < this.config.chatMaxAttempts) {
      attempts += 1;

      try {
        const session = await this.ensureAuthenticated({ allowAutoLogin: true });
        const runner = skipQueue
          ? () => execute({ session })
          : () => this.queue.run(() => execute({ session }), { signal });

        const result = await runner();
        return {
          ...result,
          attempts,
          refreshedSession
        };
      } catch (error) {
        lastError = error;

        if (shouldRefreshSession(error) && attempts < this.config.chatMaxAttempts) {
          this.metrics.recordChatRetry();
          this.metrics.recordAuthAttempt({ strategy: 'auto' });

          try {
            const refreshResult = await this.sessionManager.refreshSession({
              reason: error.code || error.message
            });
            refreshedSession = true;
            this.metrics.recordAuthSuccess({
              mode: refreshResult.last_login_mode || 'auto-refresh',
              refreshed: true,
              usedBrowserFallback: refreshResult.strategy === 'password+browser-fallback'
            });
            continue;
          } catch (refreshError) {
            this.metrics.recordAuthFailure(refreshError);
            this.metrics.recordChatFailure(refreshError);
            throw refreshError;
          }
        }

        if (shouldRetryAfterBackoff(error) && attempts < this.config.chatMaxAttempts) {
          this.metrics.recordChatRetry();
          await sleep(this.config.rateLimitRetryDelayMs);
          continue;
        }

        if (stream && shouldRetryAfterBackoff(error)) {
          this.metrics.recordChatFailure(error);
          throw error;
        }

        {
          this.metrics.recordChatFailure(error);
          throw error;
        }
      }
    }

    this.metrics.recordChatFailure(lastError);
    throw lastError;
  }

  async ensureAuthenticated({ allowAutoLogin = false } = {}) {
    try {
      return await this.sessionManager.requireSession({ allowAutoLogin });
    } catch (error) {
      if (allowAutoLogin && error instanceof AuthenticationRequiredError) {
        await this.sessionManager.loginAuto({ force: true });
        return this.sessionManager.requireSession();
      }

      throw error;
    }
  }
}

function shouldRefreshSession(error) {
  if (error instanceof AuthenticationRequiredError) {
    return true;
  }

  if (!(error instanceof UpstreamError)) {
    return false;
  }

  const upstreamCode = error.details?.upstream_code;
  const upstreamMessage = String(error.details?.upstream_message || '');

  return (
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.code === 'upstream_401' ||
    error.code === 'upstream_deepseek_40300' ||
    String(upstreamCode || '').startsWith('401') ||
    upstreamCode === 40300 ||
    /AUTH|TOKEN|LOGIN|SESSION|MISSING_HEADER/iu.test(upstreamMessage)
  );
}

function shouldRetryAfterBackoff(error) {
  return (
    error instanceof UpstreamError &&
    (error.statusCode === 429 ||
      error.code === 'upstream_rate_limit' ||
      error.details?.finish_reason === 'rate_limit_reached')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function primeStream(stream) {
  const iterator = stream[Symbol.asyncIterator]();
  const firstChunk = await iterator.next();

  if (firstChunk.done) {
    throw new UpstreamError('DeepSeek stream completed before any assistant content was emitted.', {
      statusCode: 502,
      code: 'upstream_empty_stream'
    });
  }

  return {
    firstDelta: firstChunk.value,
    stream: replayStream(iterator)
  };
}

async function* replayStream(iterator) {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return;
    }

    yield next.value;
  }
}
