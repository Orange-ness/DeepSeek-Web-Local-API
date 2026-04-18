# DeepSeek Web Local API

A local Node.js server that exposes an OpenAI-compatible API on top of `https://chat.deepseek.com`.

## Features

- OpenAI-compatible `POST /v1/chat/completions` with regular and streaming SSE responses
- Password-first auto login with browser fallback
- Persistent local DeepSeek session reuse
- Built-in PoW challenge solving for `chat.deepseek.com`
- Local metrics and upstream debug trace endpoints
- Helper scripts for smoke tests, verification, and first-time setup

## Requirements

- Node.js 25+
- Chromium installed locally, default path: `/usr/bin/chromium`

## Quick Start

```bash
npm install
cp .env.example .env
npm run setup
```

If you prefer to start the server yourself:

```bash
npm start
```

The server listens on `127.0.0.1:8787` by default.

## Authentication

Visible browser bootstrap:

```bash
curl -X POST http://127.0.0.1:8787/auth/login/browser
```

Password login:

```bash
curl -X POST http://127.0.0.1:8787/auth/login/password \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"secret"}'
```

Recommended automatic login flow:

```bash
curl -X POST http://127.0.0.1:8787/auth/login/auto \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"secret"}'
```

`/auth/login/auto` uses this order:

1. Reuse the current session if it is still usable
2. Try password login in headless Chromium when credentials are available
3. Fall back to visible Chromium if DeepSeek requires human interaction

Passwords are never written to disk.

## API Endpoints

- `GET /health`
- `GET /metrics`
- `GET /auth/status`
- `GET /auth/debug`
- `POST /auth/login/browser`
- `POST /auth/login/password`
- `POST /auth/login/auto`
- `POST /auth/logout`
- `GET /debug/upstream/latest`
- `GET /debug/upstream/:id`
- `GET /v1/models`
- `POST /v1/chat/completions`

## OpenAI-Compatible Example

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "deepseek-web-chat",
    "stream": false,
    "messages": [
      {"role":"system","content":"You are concise."},
      {"role":"user","content":"Say hello in French."}
    ]
  }'
```

Streaming:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "deepseek-web-think",
    "stream": true,
    "messages": [
      {"role":"user","content":"Explain recursion simply."}
    ]
  }'
```

## Using with OpenAI-Compatible Clients

You can add an API key to your local proxy and then use it with any app/plugin that supports custom OpenAI endpoints (like UI dashboards, IDE extensions, CLI tools).

1. Open your `.env` file and set a custom API key:
   ```env
   LOCAL_API_KEY=sk-my-secret-key
   ```
2. Restart your local server.

Now configure your external application using these settings:

- **API Base URL / Endpoint URL**: `http://127.0.0.1:8787/v1`
- **API Key / Bearer Token**: `sk-my-secret-key` (or whatever you set above)
- **Model**: `deepseek-web-chat` or `deepseek-web-think`

## Helper Scripts

Smoke test:

```bash
npm run smoke -- "Say hello in one short sentence"
```

Streaming smoke test:

```bash
npm run smoke -- --stream "Explain what an API is in one sentence"
```

JSON-mode smoke test:

```bash
npm run smoke -- --json "Return {\"status\":\"ok\"}"
```

Full verification:

```bash
npm run verify
```

Verification with visible browser bootstrap:

```bash
npm run verify -- --browser-login
```

Verification with explicit password login:

```bash
export DEEPSEEK_EMAIL="you@example.com"
export DEEPSEEK_PASSWORD="secret"
npm run verify -- --password-login
```

First-time setup:

```bash
npm run setup
```

First-time setup with an explicit verification mode:

```bash
npm run setup -- --browser-login
```

## Environment Variables

- `HOST` / `PORT`: local bind address and port
- `LOCAL_API_KEY`: require `Authorization: Bearer <key>` on the local API
- `CHROMIUM_PATH`: Chromium binary path
- `DATA_DIR`: persistent session directory, default `./.deepseek-web-api`
- `LOGIN_TIMEOUT_MS`: login wait timeout for the visible or automated browser flow
- `DEEPSEEK_EMAIL`: optional password-first auto-login email
- `DEEPSEEK_PASSWORD`: optional password-first auto-login password
- `DEEPSEEK_BASE_URL`: override the DeepSeek web API base URL
- `DEEPSEEK_SIGN_IN_URL`: override the DeepSeek sign-in page URL
- `DEEPSEEK_ORIGIN`: override the DeepSeek web origin used in default headers
- `DEEPSEEK_DS_POW_RESPONSE`: optional static PoW header override for debugging
- `LOCAL_API_BASE_URL`: helper script target, default `http://127.0.0.1:8787`
- `DEEPSEEK_LOCAL_MODEL`: default model for `npm run smoke`
- `DEEPSEEK_LOCAL_SYSTEM`: default system prompt for `npm run smoke`
- `DEEPSEEK_TEST_MESSAGE`: default message for `npm run smoke`
- `UPSTREAM_CONCURRENCY`: maximum concurrent upstream requests
- `CHAT_MAX_ATTEMPTS`: max retries for chat requests after refresh or rate limiting
- `RATE_LIMIT_RETRY_DELAY_MS`: backoff delay used after upstream rate limits
- `QUEUE_TIMEOUT_MS`: queue wait timeout in milliseconds
- `MAX_QUEUE_SIZE`: maximum queued upstream requests
- `UPSTREAM_TIMEOUT_MS`: upstream request timeout in milliseconds
- `HEALTH_TIMEOUT_MS`: timeout for health upstream probes
- `UPSTREAM_TRACE_LIMIT`: number of in-memory upstream traces to keep
- `UPSTREAM_TRACE_EVENT_LIMIT`: maximum captured SSE events per trace
- `UPSTREAM_TRACE_PREVIEW_CHARS`: maximum trace response preview size

See [.env.example](./.env.example) for a ready-to-copy template.

## Debugging and Observability

- `GET /metrics` returns local request, auth, chat, queue, and trace counters
- `GET /auth/debug` returns a sanitized view of the stored session and captured transport
- `GET /debug/upstream/latest` returns the latest captured upstream trace
- `GET /debug/upstream/:id` returns a specific upstream trace by ID
- `x-upstream-trace-id` is added to chat completion responses

If you send `debug_upstream: true` in `POST /v1/chat/completions`, the non-stream response includes `_debug.upstream_trace_id`.

`GET /debug/upstream/latest` is a global view for the whole local server. If multiple clients are using the API at the same time, it may move forward between two requests. For a stable lookup, use the response `x-upstream-trace-id` header with `GET /debug/upstream/:id`.

## Project Notes

- This project is text-only for now
- DeepSeek web endpoints may change over time
- The server stores session artifacts locally, but never persists your password
- This project depends on private web behavior from `chat.deepseek.com`, so breakage from upstream site changes is always possible

## Publishing Checklist

- Review and update `.env.example` for your deployment defaults
- Make sure `.env` and `.deepseek-web-api/` are not committed
- Run `npm test` before pushing
- Run `npm run verify` locally against a real DeepSeek session after major changes
- If you want browser-first setup during onboarding, use `npm run setup -- --browser-login`
