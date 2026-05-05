export function renderAdminDashboard() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DeepSeek Local Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f8;
      --panel: #ffffff;
      --panel-alt: #fbfcfd;
      --ink: #182026;
      --muted: #60707c;
      --line: #d8e0e5;
      --blue: #1d5fd1;
      --green: #18794e;
      --red: #c7352b;
      --amber: #a45f06;
      --shadow: 0 8px 24px rgba(24, 32, 38, 0.08);
      --input-bg: #fff;
      --pre-bg: #101820;
      --pre-fg: #d7e5ee;
      --topbar-bg: rgba(255, 255, 255, 0.94);
      --chip-ok-bg: #effaf5;
      --chip-ok-border: #9fd8bf;
      --chip-warn-bg: #fff8eb;
      --chip-warn-border: #f2d197;
      --chip-bad-bg: #fff1ef;
      --chip-bad-border: #efb1ab;
      --btn-secondary-bg: #fff;
    }

    [data-theme="dark"] {
      color-scheme: dark;
      --bg: #0d1117;
      --panel: #161b22;
      --panel-alt: #1c2129;
      --ink: #e6edf3;
      --muted: #8b949e;
      --line: #30363d;
      --blue: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --amber: #d29922;
      --shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      --input-bg: #0d1117;
      --pre-bg: #0d1117;
      --pre-fg: #c9d1d9;
      --topbar-bg: rgba(22, 27, 34, 0.94);
      --chip-ok-bg: #0d1a12;
      --chip-ok-border: #1a4d2e;
      --chip-warn-bg: #1a1604;
      --chip-warn-border: #4d3a08;
      --chip-bad-bg: #1a0c0a;
      --chip-bad-border: #5c1a16;
      --btn-secondary-bg: #21262d;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: background 0.2s, color 0.2s;
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    button {
      border: 1px solid #174ca8;
      border-radius: 6px;
      background: var(--blue);
      color: #fff;
      padding: 8px 12px;
      cursor: pointer;
      min-height: 36px;
    }

    button.secondary {
      background: var(--btn-secondary-bg);
      border-color: var(--line);
      color: var(--ink);
    }

    button.danger {
      background: var(--red);
      border-color: #9d241d;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    input,
    select,
    textarea {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      background: var(--input-bg);
      padding: 8px 10px;
    }

    textarea {
      min-height: 88px;
      resize: vertical;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    pre {
      margin: 0;
      min-height: 76px;
      max-height: 360px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--pre-bg);
      color: var(--pre-fg);
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: 1fr minmax(260px, 460px) auto;
      gap: 12px;
      align-items: center;
      border-bottom: 1px solid var(--line);
      background: var(--topbar-bg);
      backdrop-filter: blur(10px);
      padding: 12px 18px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .brand-mark {
      width: 30px;
      height: 30px;
      border-radius: 6px;
      background: linear-gradient(135deg, #1d5fd1, #19a974 70%, #f59e0b);
    }

    .brand-title {
      font-size: 16px;
      font-weight: 760;
      white-space: nowrap;
    }

    .main {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: 18px;
      display: grid;
      grid-template-columns: 1.1fr 1.4fr;
      gap: 16px;
      align-items: start;
    }

    .stack {
      display: grid;
      gap: 16px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding: 12px 14px;
    }

    .panel-title {
      font-size: 13px;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .panel-body {
      display: grid;
      gap: 12px;
      padding: 14px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .metric-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      min-height: 74px;
      background: var(--panel-alt);
    }

    .metric-name {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .metric-value {
      margin-top: 6px;
      font-size: 20px;
      font-weight: 760;
      overflow-wrap: anywhere;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 9px;
      background: var(--panel);
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .chip.ok {
      border-color: var(--chip-ok-border);
      color: var(--green);
      background: var(--chip-ok-bg);
    }

    .chip.warn {
      border-color: var(--chip-warn-border);
      color: var(--amber);
      background: var(--chip-warn-bg);
    }

    .chip.bad {
      border-color: var(--chip-bad-border);
      color: var(--red);
      background: var(--chip-bad-bg);
    }



    .split {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: end;
    }

    .output {
      display: grid;
      gap: 8px;
    }

    .muted {
      color: var(--muted);
    }

    @media (max-width: 1050px) {
      .main,
      .topbar {
        grid-template-columns: 1fr;
      }

      .metric-row,
      .grid-3 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 680px) {
      .main {
        padding: 10px;
      }

      .grid-2,
      .grid-3,
      .metric-row,
      .split {
        grid-template-columns: 1fr;
      }

      .topbar {
        padding: 10px;
      }
    }

    .theme-toggle {
      background: none;
      border: 1px solid var(--line);
      border-radius: 6px;
      cursor: pointer;
      padding: 6px 10px;
      font-size: 16px;
      line-height: 1;
      min-height: 36px;
      color: var(--ink);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .theme-toggle:hover {
      background: var(--panel-alt);
    }

    .copy-btn {
      background: var(--btn-secondary-bg);
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--muted);
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      min-height: 28px;
      transition: color 0.15s, border-color 0.15s;
    }

    .copy-btn:hover {
      color: var(--ink);
      border-color: var(--blue);
    }

    .copy-btn.copied {
      color: var(--green);
      border-color: var(--green);
    }

    .model-hint {
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
      font-style: italic;
    }

    .panel {
      transition: background 0.2s, border-color 0.2s;
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <div class="brand-title">DeepSeek Local Admin</div>
          <div class="muted" id="base-url"></div>
        </div>
      </div>
      <label>
        Local API key
        <input id="api-key" type="password" autocomplete="off" placeholder="LOCAL_API_KEY when enabled">
      </label>
      <div class="actions">
        <button class="secondary" id="save-key" type="button">Save Key</button>
        <button id="refresh" type="button">Refresh</button>
        <button class="theme-toggle" id="theme-toggle" type="button" title="Toggle dark mode">Dark</button>
      </div>
    </header>

    <main class="main">
      <section class="stack">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Status</div>
            <div class="chips" id="status-chips"></div>
          </div>
          <div class="panel-body">
            <div class="metric-row">
              <div class="metric">
                <div class="metric-name">HTTP</div>
                <div class="metric-value" id="metric-http">-</div>
              </div>
              <div class="metric">
                <div class="metric-name">Chat</div>
                <div class="metric-value" id="metric-chat">-</div>
              </div>
              <div class="metric">
                <div class="metric-name">Queue</div>
                <div class="metric-value" id="metric-queue">-</div>
              </div>
              <div class="metric">
                <div class="metric-name">Traces</div>
                <div class="metric-value" id="metric-traces">-</div>
              </div>
            </div>
            <pre id="status-json"></pre>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Authentication</div>
          </div>
          <div class="panel-body">
            <div class="grid-2">
              <label>
                Email
                <input id="login-email" type="email" autocomplete="username">
              </label>
              <label>
                Password
                <input id="login-password" type="password" autocomplete="current-password">
              </label>
            </div>
            <div class="actions">
              <button id="auto-login" type="button">Auto Login</button>
              <button class="secondary" id="password-login" type="button">Password Login</button>
              <button class="secondary" id="browser-login" type="button">Browser Login</button>
              <button class="danger" id="logout" type="button">Logout</button>
            </div>
            <pre id="auth-json"></pre>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Cleanup</div>
          </div>
          <div class="panel-body">
            <div class="grid-3">
              <label>
                Scope
                <select id="cleanup-scope">
                  <option value="tracked">tracked</option>
                  <option value="all">all</option>
                </select>
              </label>
              <label>
                Keep recent
                <input id="cleanup-keep" type="number" min="0" value="0">
              </label>
              <label>
                Max delete
                <input id="cleanup-max" type="number" min="1" value="200">
              </label>
            </div>
            <label>
              <span><input id="cleanup-dry-run" type="checkbox" style="width:auto;min-height:auto"> Dry run</span>
            </label>
            <div class="actions">
              <button id="cleanup" type="button">Run Cleanup</button>
            </div>
            <pre id="cleanup-json"></pre>
          </div>
        </div>
      </section>

      <section class="stack">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Chat Console</div>
          </div>
          <form class="panel-body" id="chat-form">
            <div class="grid-3">
              <label>
                Model
                <select id="chat-model"></select>
                <div class="model-hint" id="model-hint"></div>
              </label>
              <label>
                Reasoning mode
                <select id="reasoning-mode">
                  <option value="">auto (from model)</option>
                  <option value="Instant">Instant - fast, no thinking</option>
                  <option value="Expert">Expert - deep thinking</option>
                  <option value="Vision">Vision - image aware</option>
                </select>
                <div class="model-hint" id="reasoning-hint">Overrides the model's default reasoning mode</div>
              </label>
              <label>
                Response format
                <select id="response-format">
                  <option value="text">text</option>
                  <option value="json_object">json_object</option>
                </select>
              </label>
            </div>
            <div class="grid-3">
              <label>
                Temperature
                <input id="temperature" type="number" min="0" max="2" step="0.1" placeholder="0.7">
              </label>
              <label>
                top_p
                <input id="top-p" type="number" min="0" max="1" step="0.05" placeholder="1">
              </label>
              <label>
                max_tokens
                <input id="max-tokens" type="number" min="1" step="1" placeholder="1024">
              </label>
            </div>
            <div class="grid-2">
              <label>
                context_size
                <input id="context-size" type="number" min="1" step="1" placeholder="last N non-system messages">
              </label>
              <label>
                Attachment URL or server path
                <input id="attachment" type="text" placeholder="./scan.png or https://...">
              </label>
            </div>
            <label>
              system_prompt
              <textarea id="system-prompt" placeholder="You are a precise coding assistant."></textarea>
            </label>
            <label>
              User message
              <textarea id="user-message" required>Review this code change and list the highest-risk issue.</textarea>
            </label>
            <label>
              Tools JSON
              <textarea id="tools-json" placeholder='[{"type":"function","function":{"name":"read_file","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}]'></textarea>
            </label>
            <div class="actions">
              <label>
                <span><input id="stream" type="checkbox" style="width:auto;min-height:auto"> Stream</span>
              </label>
              <label>
                <span><input id="debug-upstream" type="checkbox" style="width:auto;min-height:auto" checked> Debug upstream</span>
              </label>
              <button type="button" id="clear-history" class="secondary">Clear history</button>
              <button type="submit">Send</button>
            </div>
            <div class="output">
              <pre id="chat-output"></pre>
              <pre id="request-json"></pre>
            </div>
          </form>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Server Logs (Traces)</div>
            <button class="secondary" id="refresh-traces" type="button" style="padding: 4px 8px; min-height: 28px; font-size: 12px;">Refresh</button>
          </div>
          <div class="panel-body">
            <div id="traces-list" style="display: grid; gap: 8px;"></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Capabilities</div>
          </div>
          <div class="panel-body">
            <div class="chips" id="mode-chips"></div>
            <pre id="capabilities-json"></pre>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">IDE Config</div>
            <button class="copy-btn" id="copy-ide" type="button">Copy</button>
          </div>
          <div class="panel-body">
            <div class="grid-2">
              <button class="secondary" type="button" data-snippet="continue">Continue</button>
              <button class="secondary" type="button" data-snippet="cline">Cline</button>
            </div>
            <pre id="ide-snippet"></pre>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script>
    const state = {
      apiKey: localStorage.getItem('deepseekLocalApiKey') || '',
      baseUrl: window.location.origin,
      capabilities: null,
      models: [],
      chatHistory: []
    };

    const el = (id) => document.getElementById(id);

    el('base-url').textContent = state.baseUrl;
    el('api-key').value = state.apiKey;

    // --- Theme ---
    const savedTheme = localStorage.getItem('deepseekTheme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
      el('theme-toggle').textContent = 'Light';
    }

    el('theme-toggle').addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        el('theme-toggle').textContent = 'Dark';
        localStorage.setItem('deepseekTheme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        el('theme-toggle').textContent = 'Light';
        localStorage.setItem('deepseekTheme', 'dark');
      }
    });

    // --- Copy IDE config ---
    el('copy-ide').addEventListener('click', async () => {
      const text = el('ide-snippet').textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const btn = el('copy-ide');
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      } catch {}
    });

    // --- IDE snippet buttons ---
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }

      const snippet = button.dataset.snippet;
      if (snippet) {
        renderIdeSnippet(snippet);
      }
    });

    // --- Model <-> Reasoning mode linking ---
    const MODEL_REASONING_MAP = {
      'deepseek-web-chat': 'Instant',
      'deepseek-web-instant': 'Instant',
      'deepseek-web-think': 'Expert',
      'deepseek-web-expert': 'Expert',
      'deepseek-web-vision': 'Vision'
    };

    el('chat-model').addEventListener('change', () => {
      const model = el('chat-model').value;
      const defaultMode = MODEL_REASONING_MAP[model] || 'Instant';
      el('reasoning-mode').value = '';
      el('model-hint').textContent = 'Default: ' + defaultMode + ' reasoning';
    });

    el('reasoning-mode').addEventListener('change', () => {
      const mode = el('reasoning-mode').value;
      if (!mode) {
        el('reasoning-hint').textContent = 'Overrides the model default reasoning mode';
        return;
      }
      el('reasoning-hint').textContent = 'Using ' + mode + ' mode (overrides model default)';
    });

    el('save-key').addEventListener('click', () => {
      state.apiKey = el('api-key').value.trim();
      localStorage.setItem('deepseekLocalApiKey', state.apiKey);
      refreshAll();
    });

    el('refresh').addEventListener('click', refreshAll);
    el('auto-login').addEventListener('click', () => login('auto'));
    el('password-login').addEventListener('click', () => login('password'));
    el('browser-login').addEventListener('click', () => login('browser'));
    el('logout').addEventListener('click', logout);
    el('cleanup').addEventListener('click', cleanupSessions);
    el('chat-form').addEventListener('submit', submitChat);
    el('clear-history').addEventListener('click', () => {
      state.chatHistory = [];
      el('chat-output').textContent = 'History cleared.';
    });
    el('refresh-traces').addEventListener('click', refreshTraces);

    refreshAll();
    refreshTraces();

    async function apiFetch(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (state.apiKey) {
        headers.authorization = 'Bearer ' + state.apiKey;
      }

      let body = options.body;
      if (body && typeof body !== 'string') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(body);
      }

      const response = await fetch(path, { ...options, headers, body });
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => '');

      if (!response.ok) {
        const error = new Error(payload?.error?.message || response.statusText || 'Request failed');
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      return { payload, response };
    }

    async function refreshAll() {
      setBusy(true);
      try {
        const [capabilities, models, auth, health, metrics, trace] = await Promise.allSettled([
          apiFetch('/v1/capabilities'),
          apiFetch('/v1/models'),
          apiFetch('/auth/status'),
          apiFetch('/health'),
          apiFetch('/metrics'),
          apiFetch('/debug/upstream/latest')
        ]);

        if (capabilities.status === 'fulfilled') {
          state.capabilities = capabilities.value.payload;
          setJson('capabilities-json', state.capabilities);
          renderModes(state.capabilities.reasoning_modes || []);
        } else {
          setJson('capabilities-json', formatError(capabilities.reason));
        }

        if (models.status === 'fulfilled') {
          state.models = models.value.payload.data || [];
          renderModelOptions(state.models);
        }

        const statusPayload = {
          auth: settledPayload(auth),
          health: settledPayload(health),
          metrics: settledPayload(metrics),
          latest_trace: settledPayload(trace)
        };
        setJson('status-json', statusPayload);
        setJson('auth-json', settledPayload(auth));
        renderStatus(statusPayload);
      } finally {
        setBusy(false);
      }
    }

    async function refreshTraces() {
      const container = el('traces-list');
      try {
        const result = await apiFetch('/debug/upstream');
        const traces = result.payload || [];
        if (traces.length === 0) {
          container.innerHTML = '<div style="color: var(--muted); font-size: 12px;">No traces available.</div>';
          return;
        }

        container.innerHTML = traces.map(trace => {
          const statusColor = trace.status === 'failed' ? 'var(--red)' : (trace.status === 'running' ? 'var(--amber)' : 'var(--green)');
          const date = new Date(trace.started_at).toLocaleTimeString();
          const errorMsg = trace.error ? \`\\nError: \${JSON.stringify(trace.error)}\` : '';
          const preview = trace.response_preview ? \`\\nPreview: \${trace.response_preview.substring(0, 100)}...\` : '';

          return \`
            <div style="border: 1px solid var(--line); border-radius: 6px; padding: 10px; background: var(--panel-alt);">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 12px; font-family: monospace; color: var(--muted);">\${trace.id}</span>
                <span style="font-size: 12px; font-weight: bold; color: \${statusColor};">\${trace.status.toUpperCase()}</span>
              </div>
              <div style="font-size: 12px; color: var(--ink);">
                <strong>\${date}</strong>\${errorMsg}\${preview}
              </div>
            </div>
          \`;
        }).join('');
      } catch (error) {
        container.innerHTML = \`<div style="color: var(--red); font-size: 12px;">Failed to load traces: \${error.message}</div>\`;
      }
    }

    async function login(mode) {
      setBusy(true);
      try {
        let path = '/auth/login/' + mode;
        let body = {};
        if (mode === 'password' || mode === 'auto') {
          const email = el('login-email').value.trim();
          const password = el('login-password').value;
          if (email && password) {
            body = { email, password };
          }
        }

        const result = await apiFetch(path, { method: 'POST', body });
        setJson('auth-json', result.payload);
        await refreshAll();
      } catch (error) {
        setJson('auth-json', formatError(error));
      } finally {
        setBusy(false);
      }
    }

    async function logout() {
      setBusy(true);
      try {
        const result = await apiFetch('/auth/logout', { method: 'POST', body: {} });
        setJson('auth-json', result.payload);
        await refreshAll();
      } catch (error) {
        setJson('auth-json', formatError(error));
      } finally {
        setBusy(false);
      }
    }

    async function cleanupSessions() {
      setBusy(true);
      try {
        const body = {
          scope: el('cleanup-scope').value,
          dry_run: el('cleanup-dry-run').checked,
          keep_recent: numberValue('cleanup-keep') || 0,
          max_delete: numberValue('cleanup-max') || 200
        };
        const result = await apiFetch('/debug/cleanup-sessions', { method: 'POST', body });
        setJson('cleanup-json', result.payload);
        await refreshAll();
      } catch (error) {
        setJson('cleanup-json', formatError(error));
      } finally {
        setBusy(false);
      }
    }

    async function submitChat(e) {
      e?.preventDefault();
      if (!el('user-message').value.trim()) {
        return;
      }

      setBusy(true);
      el('chat-output').textContent = '';

      try {
        const userContent = buildUserMessageContent();
        state.chatHistory.push({ role: 'user', content: userContent });

        const payload = buildChatPayload();
        setJson('request-json', payload);

        const response = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(state.apiKey ? { authorization: 'Bearer ' + state.apiKey } : {})
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          setJson('chat-output', await response.json().catch(() => ({ status: response.status })));
          state.chatHistory.pop(); // Remove user message on failure
          return;
        }

        let assistantContent = '';
        if (payload.stream) {
          assistantContent = await readSseText(response.body);
          el('chat-output').textContent = assistantContent;
        } else {
          const json = await response.json();
          assistantContent = json?.choices?.[0]?.message?.content;
          el('chat-output').textContent = assistantContent || JSON.stringify(json, null, 2);
        }

        if (assistantContent) {
          state.chatHistory.push({ role: 'assistant', content: assistantContent });
        }
        el('user-message').value = '';
      } catch (error) {
        setJson('chat-output', formatError(error));
        state.chatHistory.pop(); // Remove user message on failure
      } finally {
        setBusy(false);
      }
    }

    function buildUserMessageContent() {
      const message = el('user-message').value;
      const attachment = el('attachment').value.trim();
      return attachment
        ? [
            { type: 'text', text: message },
            {
              type: attachment.match(/\.(png|jpe?g|webp|gif|svg)$/i) ? 'image_url' : 'input_file',
              ...(attachment.match(/\.(png|jpe?g|webp|gif|svg)$/i)
                ? { image_url: { url: attachment } }
                : { input_file: { path: attachment } })
            }
          ]
        : message;
    }

    function buildChatPayload() {
      const payload = {
        model: el('chat-model').value || 'deepseek-web-chat',
        stream: el('stream').checked,
        debug_upstream: el('debug-upstream').checked,
        messages: state.chatHistory
      };

      const reasoningMode = el('reasoning-mode').value;
      const systemPrompt = el('system-prompt').value.trim();
      const responseFormat = el('response-format').value;
      const toolsText = el('tools-json').value.trim();

      if (reasoningMode) {
        payload.reasoning_mode = reasoningMode;
      }
      if (systemPrompt) {
        payload.system_prompt = systemPrompt;
      }
      if (responseFormat === 'json_object') {
        payload.response_format = { type: 'json_object' };
      }
      assignNumber(payload, 'temperature', 'temperature');
      assignNumber(payload, 'top_p', 'top-p');
      assignNumber(payload, 'max_tokens', 'max-tokens');
      assignNumber(payload, 'context_size', 'context-size');
      if (toolsText) {
        payload.tools = JSON.parse(toolsText);
        payload.tool_choice = 'auto';
      }

      return payload;
    }

    async function readSseText(body) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';

      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }

        buffer += decoder.decode(next.value, { stream: true });
        let boundary = buffer.indexOf('\\n\\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          text += extractSseContent(block);
          boundary = buffer.indexOf('\\n\\n');
        }
      }

      return text;
    }

    function extractSseContent(block) {
      const data = block
        .split('\\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\\n');
      if (!data || data === '[DONE]') {
        return '';
      }

      try {
        const payload = JSON.parse(data);
        return payload?.choices?.[0]?.delta?.content || '';
      } catch {
        return data;
      }
    }

    function renderStatus(payload) {
      const auth = payload.auth || {};
      const health = payload.health || {};
      const metrics = payload.metrics || {};
      el('metric-http').textContent = metrics.http?.totalRequests ?? '-';
      el('metric-chat').textContent = metrics.chat?.totalRequests ?? '-';
      el('metric-queue').textContent = metrics.queue?.pending ?? metrics.queue?.queued ?? '-';
      el('metric-traces').textContent = metrics.upstream_traces?.stored ?? metrics.traces?.stored ?? '-';

      const chips = [
        chip('API', health.ok ? 'ok' : 'bad'),
        chip('Session', auth.authenticated ? 'ok' : 'bad'),
        chip('Usable', auth.session_usable ? 'ok' : 'warn'),
        chip('Upstream', health.upstream?.reachable ? 'ok' : 'bad')
      ];
      el('status-chips').innerHTML = chips.join('');
    }

    function renderModes(modes) {
      el('mode-chips').innerHTML = modes.map((mode) => {
        const label = mode.id + (mode.thinking_enabled ? ' (thinking)' : '');
        return chip(label, 'ok');
      }).join('');
    }

    function renderModelOptions(models) {
      const options = models.map((model) => {
        const label = model.id + ' (' + (model.reasoning_mode || 'Instant') + ')';
        return '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(label) + '</option>';
      }).join('');
      el('chat-model').innerHTML = options || '<option value="deepseek-web-chat">deepseek-web-chat</option>';

      // Set initial hint
      const firstModel = models[0];
      if (firstModel) {
        const defaultMode = firstModel.reasoning_mode || 'Instant';
        el('model-hint').textContent = 'Default: ' + defaultMode + ' reasoning';
      }
    }

    function renderIdeSnippet(kind) {
      const apiKey = state.apiKey || 'sk-local';
      const snippets = {
        continue:
          'name: DeepSeek Local\\n' +
          'version: 0.0.1\\n' +
          'schema: v1\\n\\n' +
          'models:\\n' +
          '  - name: DeepSeek Expert\\n' +
          '    provider: openai\\n' +
          '    model: deepseek-web-expert\\n' +
          '    apiBase: ' + state.baseUrl + '/v1\\n' +
          '    apiKey: ' + apiKey + '\\n' +
          '    useResponsesApi: false\\n' +
          '    defaultCompletionOptions:\\n' +
          '      context_size: 24\\n' +
          '      reasoning_mode: Expert\\n',
        cline:
          'Provider: OpenAI Compatible\\n' +
          'Base URL: ' + state.baseUrl + '/v1\\n' +
          'API Key: ' + apiKey + '\\n' +
          'Model ID: deepseek-web-expert\\n' +
          'Max Output Tokens: 4096\\n' +
          'Context Window size: 24\\n' +
          'Image Support: enabled for deepseek-web-vision\\n'
      };

      state.lastIdeSnippet = snippets[kind] || '';
      el('ide-snippet').textContent = state.lastIdeSnippet;
    }

    function chip(text, tone) {
      return '<span class="chip ' + tone + '">' + escapeHtml(text) + '</span>';
    }

    function setJson(id, value) {
      el(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    function settledPayload(result) {
      return result.status === 'fulfilled' ? result.value.payload : formatError(result.reason);
    }

    function formatError(error) {
      return {
        ok: false,
        status: error?.status || null,
        message: error?.message || String(error),
        details: error?.payload || null
      };
    }

    function assignNumber(target, property, id) {
      const value = numberValue(id);
      if (value !== null) {
        target[property] = value;
      }
    }

    function numberValue(id) {
      const raw = el(id).value;
      if (raw === '') {
        return null;
      }

      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }

    function setBusy(isBusy) {
      document.querySelectorAll('button').forEach((button) => {
        button.disabled = isBusy;
      });
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
}
