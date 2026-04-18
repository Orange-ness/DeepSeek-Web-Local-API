import path from 'node:path';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_DATA_DIR = '.deepseek-web-api';
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60 * 1000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2 * 1000;
const DEFAULT_QUEUE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_CHAT_MAX_ATTEMPTS = 3;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 1500;

export function resolveConfig(env = process.env) {
  const cwd = process.cwd();

  return {
    host: env.HOST || DEFAULT_HOST,
    port: parsePositiveInt(env.PORT, DEFAULT_PORT),
    localApiKey: env.LOCAL_API_KEY || '',
    chromiumPath: env.CHROMIUM_PATH || '/usr/bin/chromium',
    dataDir: path.resolve(cwd, env.DATA_DIR || DEFAULT_DATA_DIR),
    deepSeekEmail: env.DEEPSEEK_EMAIL || '',
    deepSeekPassword: env.DEEPSEEK_PASSWORD || '',
    deepSeekBaseUrl: env.DEEPSEEK_BASE_URL || 'https://chat.deepseek.com/api/v0',
    deepSeekSignInUrl: env.DEEPSEEK_SIGN_IN_URL || 'https://chat.deepseek.com/sign_in',
    deepSeekOrigin: env.DEEPSEEK_ORIGIN || 'https://chat.deepseek.com',
    deepSeekDsPowResponse: env.DEEPSEEK_DS_POW_RESPONSE || '',
    upstreamConcurrency: parsePositiveInt(env.UPSTREAM_CONCURRENCY, 1),
    chatMaxAttempts: parsePositiveInt(env.CHAT_MAX_ATTEMPTS, DEFAULT_CHAT_MAX_ATTEMPTS),
    rateLimitRetryDelayMs: parsePositiveInt(env.RATE_LIMIT_RETRY_DELAY_MS, DEFAULT_RATE_LIMIT_RETRY_DELAY_MS),
    queueTimeoutMs: parsePositiveInt(env.QUEUE_TIMEOUT_MS, DEFAULT_QUEUE_TIMEOUT_MS),
    maxQueueSize: parsePositiveInt(env.MAX_QUEUE_SIZE, DEFAULT_MAX_QUEUE_SIZE),
    loginTimeoutMs: parsePositiveInt(env.LOGIN_TIMEOUT_MS, DEFAULT_LOGIN_TIMEOUT_MS),
    upstreamTimeoutMs: parsePositiveInt(env.UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS),
    healthTimeoutMs: parsePositiveInt(env.HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT_MS),
    upstreamTraceLimit: parsePositiveInt(env.UPSTREAM_TRACE_LIMIT, 20),
    upstreamTraceEventLimit: parsePositiveInt(env.UPSTREAM_TRACE_EVENT_LIMIT, 64),
    upstreamTracePreviewChars: parsePositiveInt(env.UPSTREAM_TRACE_PREVIEW_CHARS, 16000)
  };
}

function parsePositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
