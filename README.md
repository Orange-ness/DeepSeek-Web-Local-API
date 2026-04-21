# DeepSeek Web Local API

A local Node.js server that exposes an OpenAI-compatible API on top of `https://chat.deepseek.com`.

## Features

- OpenAI-compatible `POST /v1/chat/completions` with regular and streaming SSE responses
- OpenAI-compatible function calling emulation with `tools`, `tool_choice`, and `role: tool`
- File attachment support for parseable DeepSeek Web files, including OCR-friendly images
- Password-first auto login with browser fallback
- Persistent local DeepSeek session reuse
- Built-in PoW challenge solving for `chat.deepseek.com`
- Best-effort upstream chat session deletion after replies
- Startup cleanup for tracked orphan chat sessions left behind by crashes or hard stops
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
- `POST /debug/cleanup-sessions`
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

Function calling:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "deepseek-web-chat",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather for a city",
          "parameters": {
            "type": "object",
            "properties": {
              "city": { "type": "string" }
            },
            "required": ["city"]
          }
        }
      }
    ],
    "messages": [
      {"role":"user","content":"What is the weather in Brussels right now?"}
    ]
  }'
```

File attachment with a local text file:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "deepseek-web-chat",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type":"text","text":"What animal is mentioned in the attached file?"},
          {
            "type":"input_file",
            "input_file": {
              "path": "./notes.txt"
            }
          }
        ]
      }
    ]
  }'
```

Image attachment with a local path:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "deepseek-web-chat",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type":"text","text":"What text is visible in this image?"},
          {
            "type":"image_url",
            "image_url": {
              "url": "./scan.png"
            }
          }
        ]
      }
    ]
  }'
```

Data URL image attachment:

```json
{
  "model": "deepseek-web-chat",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Summarize this image." },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
          }
        }
      ]
    }
  ]
}
```

Supported attachment inputs:

- `image_url.url`: `http(s)://`, `data:`, `file://`, absolute paths, or relative local paths
- `input_file.path`: local file path
- `input_file.url`: remote URL or `file://` URL
- `input_file.data` / `input_file.file_data`: base64 or `data:` URL

Important limitation:

- DeepSeek Web currently treats attachments through its file extraction pipeline.
- That means text files work well, and images work when DeepSeek can extract usable text or OCR content from them.
- Pure vision-style image understanding is not guaranteed on the current web flow or current account/model configuration.
- If DeepSeek ends parsing with statuses like `CONTENT_EMPTY`, the local API returns a clear `400` instead of forwarding an opaque upstream `invalid ref file id`.

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

For compatibility with clients like Continue, the server also accepts several common OpenAI chat fields when they are harmless, such as `top_p`, `presence_penalty`, `frequency_penalty`, `stop`, `stream_options`, and `max_completion_tokens`. It also supports OpenAI-style function calling payloads with `tools`, `tool_choice`, assistant `tool_calls`, and follow-up `role: tool` messages.

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

Attachment smoke tests:

```bash
npm run smoke -- --file ./notes.txt "Summarize the attached file"
npm run smoke -- --image ./scan.png "What text is in this image?"
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
- `DELETE_CHAT_SESSION_AFTER_COMPLETION`: delete the upstream DeepSeek chat session after each request, default `true`
- `DELETE_CHAT_SESSION_TIMEOUT_MS`: timeout for the best-effort delete call
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
- `POST /debug/cleanup-sessions` manually deletes chat sessions from the DeepSeek account
- `GET /debug/upstream/latest` returns the latest captured upstream trace
- `GET /debug/upstream/:id` returns a specific upstream trace by ID
- `x-upstream-trace-id` is added to chat completion responses

If you send `debug_upstream: true` in `POST /v1/chat/completions`, the non-stream response includes `_debug.upstream_trace_id`.

`GET /debug/upstream/latest` is a global view for the whole local server. If multiple clients are using the API at the same time, it may move forward between two requests. For a stable lookup, use the response `x-upstream-trace-id` header with `GET /debug/upstream/:id`.

By default, the server also sends a best-effort `POST /chat_session/delete` request to DeepSeek after each completion so the web account does not accumulate one chat thread per API call. Delete failures are ignored and do not fail the user response.

At startup, the server also retries deletion for locally tracked chat sessions that were created by the API but never cleaned up because the process crashed or stopped abruptly.

Manual cleanup examples:

```bash
curl -X POST http://127.0.0.1:8787/debug/cleanup-sessions \
  -H 'content-type: application/json' \
  -d '{"scope":"all","keep_recent":5,"max_delete":200}'
```

```bash
curl -X POST http://127.0.0.1:8787/debug/cleanup-sessions \
  -H 'content-type: application/json' \
  -d '{"scope":"tracked"}'
```

`scope: "all"` deletes chat sessions visible on the account, while `scope: "tracked"` only retries locally tracked orphan sessions created by this API.

## Function Calling Notes

- Function calling is emulated locally on top of DeepSeek Web, it is not native DeepSeek tool calling
- The adapter forces a JSON-only intermediate format, validates it locally, and converts it back into OpenAI-style `tool_calls`
- Regular non-stream responses are supported
- Streaming tool calls are supported through a synthetic OpenAI-compatible SSE stream
- Non-empty tool/function declarations are supported, but only for function tools
- `n > 1`, audio output, and non-text modalities are still unsupported

## Project Notes

- This project is text-only for now
- DeepSeek web endpoints may change over time
- The server stores session artifacts locally, but never persists your password
- Password-only login is more robust now, but DeepSeek anti-bot checks or social-login-only accounts can still force a visible browser fallback
- This project depends on private web behavior from `chat.deepseek.com`, so breakage from upstream site changes is always possible
