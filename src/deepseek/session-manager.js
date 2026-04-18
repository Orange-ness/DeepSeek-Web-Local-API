import { chromium } from 'playwright-core';
import {
  AuthenticationRequiredError,
  BadRequestError,
  LoginTimeoutError
} from '../errors.js';
import { SessionStore } from '../storage.js';
import { createDefaultTransportTemplate, DEFAULT_USER_AGENT } from './defaults.js';

const SESSION_EXPIRY_SKEW_MS = 30_000;

export class DeepSeekSessionManager {
  constructor(config, store = new SessionStore(config)) {
    this.config = config;
    this.store = store;
  }

  async getStatus() {
    const session = await this.store.load();
    return formatSessionStatus(session, {
      hasConfiguredCredentials: this.hasConfiguredCredentials()
    });
  }

  async getDebugInfo() {
    const session = await this.store.load();

    return {
      ...formatSessionStatus(session, {
        hasConfiguredCredentials: this.hasConfiguredCredentials()
      }),
      session_present: Boolean(session),
      auth_token_present: Boolean(session?.authToken),
      cookie_header_present: Boolean(session?.cookieHeader),
      cookie_names: extractCookieNames(session?.cookieHeader),
      local_storage_keys: Object.keys(session?.localStorage || {}).sort(),
      transport: session?.transport
        ? {
            source: session.transport.source || null,
            captured_at: session.transport.capturedAt || null,
            base_url: session.transport.baseUrl || null,
            create_chat_session_url: session.transport.createChatSessionUrl || null,
            chat_completion_url: session.transport.chatCompletionUrl || null,
            header_keys: Object.keys(session.transport.headers || {}).sort()
          }
        : null
    };
  }

  async requireSession({ allowAutoLogin = false } = {}) {
    const session = await this.store.load();
    if (isSessionUsable(session)) {
      return session;
    }

    if (allowAutoLogin) {
      await this.loginAuto({ force: true });
      const refreshed = await this.store.load();
      if (isSessionUsable(refreshed)) {
        return refreshed;
      }
    }

    throw new AuthenticationRequiredError('DeepSeek is not authenticated yet. Please log in first.');
  }

  hasConfiguredCredentials() {
    return Boolean(this.config.deepSeekEmail && this.config.deepSeekPassword);
  }

  getConfiguredCredentials() {
    if (!this.hasConfiguredCredentials()) {
      return null;
    }

    return {
      email: this.config.deepSeekEmail,
      password: this.config.deepSeekPassword
    };
  }

  async loginWithBrowser() {
    return this.runVisibleLoginFlow({ mode: 'browser' });
  }

  async loginWithPassword(credentials, { allowBrowserFallback = true } = {}) {
    const normalizedCredentials = normalizeCredentials(credentials) || this.getConfiguredCredentials();
    if (!normalizedCredentials) {
      throw new BadRequestError('Email and password are required for password login.');
    }

    try {
      return await this.runAutomatedPasswordFlow(normalizedCredentials, {
        mode: 'password'
      });
    } catch (error) {
      if (!allowBrowserFallback) {
        throw error;
      }

      return this.runVisibleLoginFlow({
        mode: 'password+browser-fallback',
        credentials: normalizedCredentials
      });
    }
  }

  loginAuto(options) {
    if (this._loginPromise) {
      return this._loginPromise;
    }

    this._loginPromise = this._loginAuto(options).finally(() => {
      this._loginPromise = null;
    });

    return this._loginPromise;
  }

  async _loginAuto({
    email,
    password,
    force = false,
    preferBrowser = false,
    browserFallback = true
  } = {}) {
    const session = await this.store.load();
    if (!force && isSessionUsable(session)) {
      return {
        ...formatSessionStatus(session, {
          hasConfiguredCredentials: this.hasConfiguredCredentials()
        }),
        strategy: 'existing-session'
      };
    }

    const providedCredentials = normalizeCredentials({ email, password });
    const credentials = providedCredentials || this.getConfiguredCredentials();

    if (preferBrowser) {
      return {
        ...(await this.runVisibleLoginFlow({
          mode: credentials ? 'browser-preferred' : 'browser'
        })),
        strategy: 'browser'
      };
    }

    if (credentials) {
      const result = await this.loginWithPassword(credentials, {
        allowBrowserFallback: browserFallback
      });

      return {
        ...result,
        strategy: result.last_login_mode === 'password' ? 'password' : 'password+browser-fallback'
      };
    }

    return {
      ...(await this.runVisibleLoginFlow({ mode: 'browser' })),
      strategy: 'browser'
    };
  }

  async refreshSession({ reason } = {}) {
    const result = await this.loginAuto({ force: true });

    return {
      ...result,
      refresh_reason: reason || null
    };
  }

  async logout() {
    await this.store.clear();
    return formatSessionStatus(null, {
      hasConfiguredCredentials: this.hasConfiguredCredentials()
    });
  }

  async runAutomatedPasswordFlow(credentials, { mode }) {
    return this.withBrowserContext({ headless: true }, async ({ context, page, capture }) => {
      await page.goto(this.config.deepSeekSignInUrl, { waitUntil: 'domcontentloaded' });
      await this.fillCredentials(page, credentials);
      await this.submitLogin(page);

      const session = await this.waitForAuthenticatedSession(
        context,
        page,
        capture,
        mode,
        this.config.loginTimeoutMs / 2
      );

      await this.store.save(session);
      return formatSessionStatus(session, {
        hasConfiguredCredentials: this.hasConfiguredCredentials()
      });
    });
  }

  async runVisibleLoginFlow({ mode, credentials }) {
    return this.withBrowserContext({ headless: false }, async ({ context, page, capture }) => {
      await page.goto(this.config.deepSeekSignInUrl, { waitUntil: 'domcontentloaded' });

      if (credentials) {
        await this.fillCredentials(page, credentials, { bestEffort: true });
        await this.submitLogin(page, { optional: true });
      }

      const session = await this.waitForAuthenticatedSession(
        context,
        page,
        capture,
        mode,
        this.config.loginTimeoutMs
      );

      await this.store.save(session);
      return formatSessionStatus(session, {
        hasConfiguredCredentials: this.hasConfiguredCredentials()
      });
    });
  }

  async withBrowserContext({ headless }, fn) {
    await this.store.ensure();
    const context = await chromium.launchPersistentContext(this.store.userDataDir, {
      executablePath: this.config.chromiumPath,
      headless,
      viewport: { width: 1440, height: 960 },
      args: ['--disable-blink-features=AutomationControlled']
    });

    const capture = new TransportCapture(this.config);
    capture.attach(context);

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      return await fn({ context, page, capture });
    } finally {
      await context.close();
    }
  }

  async fillCredentials(page, { email, password }, options = {}) {
    await fillFirstAvailable(
      page,
      [
        'input[type="email"]',
        'input[name="email"]',
        'input[autocomplete="username"]'
      ],
      email,
      options
    );

    await fillFirstAvailable(
      page,
      [
        'input[type="password"]',
        'input[name="password"]',
        'input[autocomplete="current-password"]'
      ],
      password,
      options
    );
  }

  async submitLogin(page, { optional = false } = {}) {
    const selectors = [
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Continue")'
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.click();
        return true;
      }
    }

    if (!optional) {
      throw new Error('Could not find a login submit button.');
    }

    return false;
  }

  async waitForAuthenticatedSession(context, page, capture, mode, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const snapshot = await readBrowserSnapshot(page, context);
      if (snapshot.authToken && snapshot.cookieHeader) {
        return {
          authenticated: true,
          lastLoginMode: mode,
          updatedAt: new Date().toISOString(),
          expiresAt: decodeTokenExpiry(snapshot.authToken),
          authToken: snapshot.authToken,
          cookieHeader: snapshot.cookieHeader,
          userAgent: snapshot.userAgent || DEFAULT_USER_AGENT,
          localStorage: snapshot.localStorage,
          transport: capture.toTemplate(snapshot)
        };
      }

      await page.waitForTimeout(1000);
    }

    throw new LoginTimeoutError();
  }
}

class TransportCapture {
  constructor(config) {
    this.config = config;
    this.requests = [];
  }

  attach(context) {
    context.on('request', (request) => {
      if (!request.url().includes('/api/')) {
        return;
      }

      this.requests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers()
      });
    });
  }

  toTemplate(snapshot) {
    const defaults = createDefaultTransportTemplate(this.config, {
      userAgent: snapshot.userAgent,
      source: this.requests.length ? 'browser-capture' : 'fallback-defaults',
      capturedAt: new Date().toISOString()
    });

    const createRequest = this.requests.find((request) => request.url.includes('/chat_session/create'));
    const completionRequest = this.requests.find((request) => request.url.includes('/chat/completion'));
    const headerSource = completionRequest?.headers || createRequest?.headers || {};

    return {
      ...defaults,
      ...(createRequest?.url ? { createChatSessionUrl: createRequest.url } : {}),
      ...(completionRequest?.url ? { chatCompletionUrl: completionRequest.url } : {}),
      headers: {
        ...defaults.headers,
        ...pickHeaders(headerSource, [
          'x-app-version',
          'x-client-locale',
          'x-client-version',
          'x-ds-pow-response',
          'user-agent'
        ])
      }
    };
  }
}

async function fillFirstAvailable(page, selectors, value, { bestEffort = false } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.fill(value);
      return true;
    }
  }

  if (!bestEffort) {
    throw new Error(`Could not find an input matching: ${selectors.join(', ')}`);
  }

  return false;
}

async function readBrowserSnapshot(page, context) {
  const state = await context.storageState();
  const originState = state.origins.find((origin) => origin.origin === 'https://chat.deepseek.com');
  const localStorage = Object.fromEntries(
    (originState?.localStorage || []).map((entry) => [entry.name, entry.value])
  );

  const authToken = extractToken(localStorage.userToken);
  const cookieHeader = state.cookies
    .filter((cookie) => domainMatches(cookie.domain, 'deepseek.com'))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => DEFAULT_USER_AGENT);

  return {
    authToken,
    cookieHeader,
    localStorage,
    userAgent
  };
}

function normalizeCredentials(credentials) {
  if (!credentials?.email || !credentials?.password) {
    return null;
  }

  return {
    email: credentials.email,
    password: credentials.password
  };
}

function isSessionUsable(session) {
  if (!session?.authenticated || !session?.authToken || !session?.cookieHeader) {
    return false;
  }

  if (!session.expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - SESSION_EXPIRY_SKEW_MS > Date.now();
}

function extractToken(rawToken) {
  if (!rawToken) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawToken);
    return parsed?.value || parsed?.token || '';
  } catch {
    return rawToken;
  }
}

function decodeTokenExpiry(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp) {
      return null;
    }

    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return null;
  }
}

function pickHeaders(headers, names) {
  const normalized = {};

  for (const name of names) {
    if (headers[name]) {
      normalized[name] = headers[name];
    }
  }

  return normalized;
}

function domainMatches(domain, suffix) {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function extractCookieNames(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean)
    .sort();
}

function formatSessionStatus(session, { hasConfiguredCredentials = false } = {}) {
  return {
    authenticated: Boolean(session?.authenticated),
    session_usable: isSessionUsable(session),
    has_configured_credentials: hasConfiguredCredentials,
    expires_at: session?.expiresAt || null,
    last_login_mode: session?.lastLoginMode || null,
    updated_at: session?.updatedAt || null,
    transport_source: session?.transport?.source || null
  };
}
