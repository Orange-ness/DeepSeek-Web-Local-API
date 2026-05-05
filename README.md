# DeepSeek Web Local API

A local Node.js server that exposes an OpenAI-compatible API on top of `https://chat.deepseek.com`.

## Features

- OpenAI-compatible `POST /v1/chat/completions` with regular and streaming SSE responses
- OpenAI-compatible function calling emulation with `tools`, `tool_choice`, and `role: tool`
- Advanced local controls: `reasoning_mode`, `temperature`, `top_p`, `max_tokens`, `context_size`, and `system_prompt`
- File attachment support for parseable DeepSeek Web files, including OCR-friendly images
- Lightweight local admin dashboard at `GET /admin`
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

### Admin dashboard:

Open `http://127.0.0.1:8787/admin` while the server is running. If `LOCAL_API_KEY` is set, enter it in the dashboard header; the page itself is public on the local bind address, but API data endpoints still require the bearer token.

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
- `GET /debug/upstream`
- `GET /debug/upstream/latest`
- `GET /debug/upstream/:id`
- `GET /v1/models`
- `GET /v1/capabilities`
- `POST /v1/chat/completions`
- `GET /admin`

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

Advanced controls:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "deepseek-web-chat",
    "reasoning_mode": "Expert",
    "temperature": 0.2,
    "top_p": 0.9,
    "max_tokens": 1024,
    "context_size": 8,
    "system_prompt": "You are a careful senior code reviewer.",
    "messages": [
      {"role":"user","content":"Review this patch and list the highest-risk issue first."}
    ]
  }'
```

Reasoning modes:

- `Instant`: fast chat path, DeepSeek thinking disabled
- `Expert`: reasoning path, DeepSeek thinking enabled
- `Vision`: attachment-aware path for image and file inputs

You can select a mode with `reasoning_mode` / `mode` or by using `deepseek-web-instant`, `deepseek-web-expert`, or `deepseek-web-vision`.

The legacy IDs still work: `deepseek-web-chat`, `deepseek-chat`, `deepseek-web-think`, and `deepseek-reasoner`.

`context_size` keeps the most recent non-system conversation messages while preserving `system` and `developer` instructions. `system_prompt` is prepended as an additional system instruction so clients can set behavior without rewriting the `messages` array.

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
- **Model**: `deepseek-web-instant`, `deepseek-web-expert`, `deepseek-web-vision`, `deepseek-web-chat`, or `deepseek-web-think`

For compatibility with coding assistants, the server accepts common OpenAI chat fields such as `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `presence_penalty`, `frequency_penalty`, `stop`, `stream_options`, and `reasoning_effort`. It also supports OpenAI-style function calling payloads with `tools`, `tool_choice`, assistant `tool_calls`, and follow-up `role: tool` messages.

Capability discovery:

```bash
curl http://127.0.0.1:8787/v1/capabilities
```

### Continue

Official docs: <https://docs.continue.dev/customize/model-providers/top-level/openai>

`config.yaml`:

```yaml
name: DeepSeek Local
version: 0.0.1
schema: v1

models:
  - name: DeepSeek Expert
    provider: openai
    model: deepseek-web-expert
    apiBase: http://127.0.0.1:8787/v1
    apiKey: sk-my-secret-key
    useResponsesApi: false
    defaultCompletionOptions:
      temperature: 0.2
      top_p: 0.9
      max_tokens: 4096
      reasoning_mode: Expert
      context_size: 24
```

Use `deepseek-web-expert` for code generation, refactors, and review. Use `deepseek-web-instant` for quick edits. Continue can send OpenAI `tools` payloads; this API converts them to local function-calling emulation.

### Cline

Official docs: <https://docs.cline.bot/provider-config/openai-compatible>

In Cline settings:

- API Provider: `OpenAI Compatible`
- Base URL: `http://127.0.0.1:8787/v1`
- API Key: `sk-my-secret-key`
- Model ID: `deepseek-web-expert`
- Max Output Tokens: `4096`
- Context Window size: use your preferred local history window, for example `24`
- Image Support: enable when using `deepseek-web-vision`

Cline agent/tool requests are supported through OpenAI-compatible `tools`, `tool_choice`, and `role: tool` messages. Function calling is emulated locally, so tool schemas should stay explicit and JSON-object based.

CLI setup example:

```bash
cline auth -p openai -k sk-my-secret-key -m deepseek-web-expert -b http://127.0.0.1:8787/v1
```

### Zed

Official docs: <https://zed.dev/docs/ai/llm-providers>

You can configure the local DeepSeek proxy directly through the Zed user interface:

1. Click on the three dots menu in the Assistant panel and go to the Settings. (Or press Ctrl+Alt+C to open Settings.)
2. Under the **LLM Providers** category, click **Add provider** and select **OpenAI**.
3. Fill in the following configuration:
   - **Provider name**: `DeepSeek Local` (or any name you prefer)
   - **API URL**: `http://127.0.0.1:8787/v1`
   - **API Key**: The `LOCAL_API_KEY` you configured in your `.env` file
   - **Model name**: Enter the name of the model you want to use (e.g., `deepseek-web-expert`, `deepseek-web-instant`, `deepseek-web-vision`). You can add multiple models.
   - **Max Completion Tokens**, **Max Output Tokens**, **Max Tokens**: Set these to the maximum possible values (e.g., `4096` for output, `128000` for context).
4. Configure the model capabilities based on the model you chose. For example, for `deepseek-web-expert`:
   - **Supports tools**: `True`
   - **Supports images**: `False`
   - **Supports parallel_tool_calls**: `True`
   - **Supports prompt_cache_key**: `False`
   - **Supports /chat/completions**: `True`

Use `deepseek-web-vision` if you need image support (`Supports images: True`).

## Helper Scripts

Smoke test:

```bash
npm run smoke -- "Say hello in one short sentence"
```

Streaming smoke test:

```bash
npm run smoke -- --stream "Explain what an API is in one sentence"
```

Advanced smoke test:

```bash
npm run smoke -- --mode Expert --temperature 0.2 --max-tokens 512 "Review this function"
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
- `DEEPSEEK_LOCAL_REASONING_MODE`: default `reasoning_mode` for `npm run smoke`
- `DEEPSEEK_LOCAL_TEMPERATURE`: default `temperature` for `npm run smoke`
- `DEEPSEEK_LOCAL_TOP_P`: default `top_p` for `npm run smoke`
- `DEEPSEEK_LOCAL_MAX_TOKENS`: default `max_tokens` for `npm run smoke`
- `DEEPSEEK_LOCAL_CONTEXT_SIZE`: default `context_size` for `npm run smoke`
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
- `GET /v1/capabilities` returns supported modes, tunable parameters, endpoints, and IDE-facing features
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

- Vision mode uses DeepSeek Web attachments and file extraction; pure image understanding depends on the upstream account and web behavior
- DeepSeek web endpoints may change over time
- The server stores session artifacts locally, but never persists your password
- Password-only login is more robust now, but DeepSeek anti-bot checks or social-login-only accounts can still force a visible browser fallback
- This project depends on private web behavior from `chat.deepseek.com`, so breakage from upstream site changes is always possible
