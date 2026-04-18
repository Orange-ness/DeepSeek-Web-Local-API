# Contributing

## Local Workflow

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` if you want local defaults.
3. Run `npm test` for unit tests.
4. Run `npm run verify` against a real DeepSeek session before opening a pull request.

## Pull Request Notes

- Keep the public API compatible unless the change is explicitly intentional.
- Do not commit `.env`, `.env.local`, or `.deepseek-web-api/`.
- Do not persist user passwords to disk.
- Update `README.md` when adding endpoints, scripts, or environment variables.

## Testing Expectations

- `npm test` should pass for every change.
- If you modify the DeepSeek transport, session capture, SSE parsing, or auth flow, also run `npm run verify`.
