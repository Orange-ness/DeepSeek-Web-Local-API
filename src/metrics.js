export class MetricsStore {
  constructor() {
    this.startedAt = Date.now();
    this.http = {
      totalRequests: 0,
      inflightRequests: 0,
      statusCodes: {},
      routes: {}
    };
    this.auth = {
      loginAttempts: 0,
      loginSuccesses: 0,
      loginFailures: 0,
      autoLogins: 0,
      browserFallbacks: 0,
      refreshes: 0,
      lastLoginMode: null,
      lastFailure: null
    };
    this.chat = {
      totalRequests: 0,
      streamRequests: 0,
      nonStreamRequests: 0,
      retries: 0,
      failures: 0,
      lastModel: null,
      lastTraceId: null,
      lastError: null
    };
  }

  beginHttpRequest() {
    this.http.totalRequests += 1;
    this.http.inflightRequests += 1;
  }

  endHttpRequest({ route, method, statusCode, durationMs }) {
    this.http.inflightRequests = Math.max(0, this.http.inflightRequests - 1);
    this.http.statusCodes[statusCode] = (this.http.statusCodes[statusCode] || 0) + 1;

    const key = `${method} ${route || 'unmatched'}`;
    const routeMetrics = this.http.routes[key] || {
      count: 0,
      last_status_code: null,
      last_duration_ms: null
    };

    routeMetrics.count += 1;
    routeMetrics.last_status_code = statusCode;
    routeMetrics.last_duration_ms = durationMs;
    this.http.routes[key] = routeMetrics;
  }

  recordAuthAttempt({ strategy }) {
    this.auth.loginAttempts += 1;
    if (strategy === 'auto') {
      this.auth.autoLogins += 1;
    }
  }

  recordAuthSuccess({ mode, usedBrowserFallback = false, refreshed = false }) {
    this.auth.loginSuccesses += 1;
    this.auth.lastLoginMode = mode;
    this.auth.lastFailure = null;

    if (usedBrowserFallback) {
      this.auth.browserFallbacks += 1;
    }

    if (refreshed) {
      this.auth.refreshes += 1;
    }
  }

  recordAuthFailure(error) {
    this.auth.loginFailures += 1;
    this.auth.lastFailure = error?.message || String(error);
  }

  recordChatRequest({ model, stream, traceId }) {
    this.chat.totalRequests += 1;
    this.chat.lastModel = model;
    this.chat.lastTraceId = traceId || null;

    if (stream) {
      this.chat.streamRequests += 1;
      return;
    }

    this.chat.nonStreamRequests += 1;
  }

  recordChatRetry() {
    this.chat.retries += 1;
  }

  recordChatFailure(error) {
    this.chat.failures += 1;
    this.chat.lastError = error?.message || String(error);
  }

  snapshot({ queue, traceStore } = {}) {
    return {
      started_at: new Date(this.startedAt).toISOString(),
      uptime_ms: Date.now() - this.startedAt,
      http: this.http,
      auth: this.auth,
      chat: this.chat,
      queue: queue?.snapshot?.() || null,
      upstream_traces: traceStore?.snapshot?.() || null
    };
  }
}
