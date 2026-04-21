import Fastify from 'fastify';
import { ZodError } from 'zod';
import { resolveConfig } from './config.js';
import { AppError, BadRequestError, LocalApiAuthError } from './errors.js';
import { toSseFrame } from './openai.js';
import { DeepSeekWebClient } from './deepseek/client.js';
import { DeepSeekSessionManager } from './deepseek/session-manager.js';
import { DeepSeekApiService } from './service.js';
import { MetricsStore } from './metrics.js';

export function buildApp({
  config = resolveConfig(),
  sessionManager = new DeepSeekSessionManager(config),
  client = new DeepSeekWebClient(config),
  metrics = new MetricsStore()
} = {}) {
  const app = Fastify({
    logger: false,
    disableRequestLogging: true
  });

  const service = new DeepSeekApiService({
    config,
    sessionManager,
    client,
    metrics
  });
  app.decorate('deepSeekService', service);

  app.addHook('onRequest', async (request) => {
    request.metricsStartedAt = Date.now();
    service.metrics.beginHttpRequest();

    if (!config.localApiKey) {
      return;
    }

    const header = request.headers.authorization || '';
    const expected = `Bearer ${config.localApiKey}`;
    if (header !== expected) {
      throw new LocalApiAuthError();
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    service.metrics.endHttpRequest({
      route: request.routeOptions?.url || request.url,
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Date.now() - (request.metricsStartedAt || Date.now())
    });
  });

  app.get('/health', async () => service.getHealth());
  app.get('/metrics', async () => service.getMetrics());
  app.get('/auth/status', async () => service.getAuthStatus());
  app.get('/auth/debug', async () => service.getAuthDebug());
  app.post('/auth/login/browser', async () => service.loginWithBrowser());
  app.post('/auth/login/auto', async (request) => service.loginAuto(request.body || {}));
  app.post('/auth/login/password', async (request) => service.loginWithPassword(request.body || {}));
  app.post('/auth/logout', async () => service.logout());
  app.post('/debug/cleanup-sessions', async (request) => service.cleanupSessions(request.body || {}));
  app.get('/debug/upstream/latest', async () => service.getLatestUpstreamTrace());
  app.get('/debug/upstream/:id', async (request) => service.getUpstreamTraceById(request.params.id));
  app.get('/v1/models', async () => service.listModels());

  app.post('/v1/chat/completions', async (request, reply) => {
    const signal = createAbortSignal(request);
    const parsed = service.parseChatRequest(request.body || {});

    if (!parsed.request.stream) {
      const response = await service.createCompletion(request.body || {}, { signal });
      if (response?._debug?.upstream_trace_id) {
        reply.header('x-upstream-trace-id', response._debug.upstream_trace_id);
      }
      return response;
    }

    const handle = await service.startStreamingCompletion(request.body || {}, { signal });
    reply.raw.statusCode = 200;
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    if (handle.traceId) {
      reply.raw.setHeader('x-upstream-trace-id', handle.traceId);
    }
    reply.raw.flushHeaders?.();

    try {
      if (Array.isArray(handle.sseFrames)) {
        for (const frame of handle.sseFrames) {
          reply.raw.write(toSseFrame(frame));
        }
        reply.raw.write(toSseFrame('[DONE]'));
        reply.raw.end();
        return reply;
      }

      reply.raw.write(toSseFrame(service.initialChunk(handle)));
      if (handle.firstDelta) {
        reply.raw.write(toSseFrame(service.contentChunk({ ...handle, delta: handle.firstDelta })));
      }
      for await (const delta of handle.stream) {
        reply.raw.write(toSseFrame(service.contentChunk({ ...handle, delta })));
      }

      reply.raw.write(toSseFrame(service.finalChunk(handle)));
      reply.raw.write(toSseFrame('[DONE]'));
      reply.raw.end();
    } finally {
      handle.release();
    }

    return reply;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (reply.raw.headersSent) {
      reply.raw.end();
      return;
    }

    const normalized = normalizeError(error);
    reply.code(normalized.statusCode).send({
      error: {
        message: normalized.message,
        type: normalized.code,
        details: normalized.details || null
      }
    });
  });

  return app;
}

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new BadRequestError('Validation failed.', error.issues);
  }

  return new AppError(error.message || 'Internal server error.');
}

function createAbortSignal(request) {
  const controller = new AbortController();

  request.raw.on('close', () => {
    if (!request.raw.complete) {
      controller.abort();
    }
  });

  return controller.signal;
}
