#!/usr/bin/env node

import { loadEnvFiles } from '../src/env.js';

loadEnvFiles();

const args = process.argv.slice(2);

let stream = false;
let debugUpstream = false;
let jsonMode = false;
let model = process.env.DEEPSEEK_LOCAL_MODEL || 'deepseek-web-chat';
let system = process.env.DEEPSEEK_LOCAL_SYSTEM || '';
let reasoningMode = process.env.DEEPSEEK_LOCAL_REASONING_MODE || '';
let temperature = process.env.DEEPSEEK_LOCAL_TEMPERATURE || '';
let topP = process.env.DEEPSEEK_LOCAL_TOP_P || '';
let maxTokens = process.env.DEEPSEEK_LOCAL_MAX_TOKENS || '';
let contextSize = process.env.DEEPSEEK_LOCAL_CONTEXT_SIZE || '';
const inputFiles = [];
const inputImages = [];
const messageParts = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === '--stream') {
    stream = true;
    continue;
  }

  if (arg === '--debug-upstream') {
    debugUpstream = true;
    continue;
  }

  if (arg === '--json') {
    jsonMode = true;
    continue;
  }

  if (arg === '--model') {
    model = args[index + 1] || model;
    index += 1;
    continue;
  }

  if (arg === '--system') {
    system = args[index + 1] || system;
    index += 1;
    continue;
  }

  if (arg === '--mode') {
    reasoningMode = args[index + 1] || reasoningMode;
    index += 1;
    continue;
  }

  if (arg === '--temperature') {
    temperature = args[index + 1] || temperature;
    index += 1;
    continue;
  }

  if (arg === '--top-p') {
    topP = args[index + 1] || topP;
    index += 1;
    continue;
  }

  if (arg === '--max-tokens') {
    maxTokens = args[index + 1] || maxTokens;
    index += 1;
    continue;
  }

  if (arg === '--context-size') {
    contextSize = args[index + 1] || contextSize;
    index += 1;
    continue;
  }

  if (arg === '--file') {
    const value = args[index + 1];
    if (value) {
      inputFiles.push(value);
      index += 1;
    }
    continue;
  }

  if (arg === '--image') {
    const value = args[index + 1];
    if (value) {
      inputImages.push(value);
      index += 1;
    }
    continue;
  }

  if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }

  messageParts.push(arg);
}

const message =
  messageParts.join(' ').trim() ||
  process.env.DEEPSEEK_TEST_MESSAGE ||
  'Say hello in one short sentence.';
const baseUrl = (process.env.LOCAL_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const apiKey = process.env.LOCAL_API_KEY || '';

const messages = [];
if (system) {
  messages.push({ role: 'system', content: system });
}
const userContentParts = [{ type: 'text', text: message }];

for (const imagePath of inputImages) {
  userContentParts.push({
    type: 'image_url',
    image_url: {
      url: imagePath
    }
  });
}

for (const filePath of inputFiles) {
  userContentParts.push({
    type: 'input_file',
    input_file: {
      path: filePath
    }
  });
}

messages.push({
  role: 'user',
  content: userContentParts.length === 1 ? message : userContentParts
});

const payload = {
  model,
  stream,
  debug_upstream: debugUpstream,
  ...(reasoningMode ? { reasoning_mode: reasoningMode } : {}),
  ...(numberOrNull(temperature) !== null ? { temperature: numberOrNull(temperature) } : {}),
  ...(numberOrNull(topP) !== null ? { top_p: numberOrNull(topP) } : {}),
  ...(numberOrNull(maxTokens) !== null ? { max_tokens: numberOrNull(maxTokens) } : {}),
  ...(numberOrNull(contextSize) !== null ? { context_size: numberOrNull(contextSize) } : {}),
  ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  messages
};

const authHeaders = {};
if (apiKey) {
  authHeaders.authorization = `Bearer ${apiKey}`;
}

const jsonHeaders = {
  ...authHeaders,
  'content-type': 'application/json'
};

try {
  const loginResult = await ensureAuthenticated(baseUrl, jsonHeaders);
  if (loginResult?.strategy) {
    console.log(`Auth strategy: ${loginResult.strategy}`);
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`Request failed: ${response.status} ${response.statusText}`);
    if (errorText) {
      console.error(errorText);
    }
    process.exit(1);
  }

  const traceId = response.headers.get('x-upstream-trace-id');

  if (!stream) {
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    if (content) {
      console.log(content);
    } else {
      console.log(JSON.stringify(json, null, 2));
    }

    if (traceId) {
      console.log(`Trace ID: ${traceId}`);
    }

    process.exit(0);
  }

  if (!response.body) {
    console.error('Streaming response body is not available.');
    process.exit(1);
  }

  await printStreamingResponse(response.body);
  if (traceId) {
    console.log(`Trace ID: ${traceId}`);
  }
} catch (error) {
  console.error(`Request error: ${error.message}`);
  process.exit(1);
}

async function ensureAuthenticated(baseUrl, headers) {
  const statusResponse = await fetch(`${baseUrl}/auth/status`, {
    method: 'GET',
    headers: authHeaders
  });

  if (!statusResponse.ok) {
    const errorText = await statusResponse.text().catch(() => '');
    throw new Error(
      `Auth status failed: ${statusResponse.status} ${statusResponse.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  const status = await statusResponse.json();
  if (status?.session_usable) {
    return {
      strategy: 'existing-session'
    };
  }

  console.log('No usable DeepSeek session found, calling /auth/login/auto...');

  const loginBody = {};
  if (process.env.DEEPSEEK_EMAIL && process.env.DEEPSEEK_PASSWORD) {
    console.log(`Using credentials from .env for: ${process.env.DEEPSEEK_EMAIL}`);
    loginBody.email = process.env.DEEPSEEK_EMAIL;
    loginBody.password = process.env.DEEPSEEK_PASSWORD;
  } else {
    console.log('No credentials found in .env, defaulting to manual browser login.');
  }

  const loginResponse = await fetch(`${baseUrl}/auth/login/auto`, {
    method: 'POST',
    headers,
    body: JSON.stringify(loginBody)
  });

  if (!loginResponse.ok) {
    const errorText = await loginResponse.text().catch(() => '');
    throw new Error(
      `Auto login failed: ${loginResponse.status} ${loginResponse.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  return loginResponse.json().catch(() => ({}));
}

async function printStreamingResponse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) {
        break;
      }

      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleSseBlock(block);
    }
  }

  if (buffer.trim()) {
    handleSseBlock(buffer);
  }

  process.stdout.write('\n');
}

function handleSseBlock(block) {
  const dataLines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (!dataLines.length) {
    return;
  }

  const data = dataLines.join('\n');
  if (data === '[DONE]') {
    return;
  }

  try {
    const payload = JSON.parse(data);
    const delta = payload?.choices?.[0]?.delta?.content;
    if (delta) {
      process.stdout.write(delta);
    }
  } catch {
    process.stdout.write(data);
  }
}

function printHelp() {
  console.log(`
Usage:
  npm run smoke -- [--stream] [--json] [--debug-upstream] [--model MODEL] [--mode Instant|Expert|Vision] [--system PROMPT] [--temperature N] [--top-p N] [--max-tokens N] [--context-size N] [--image PATH] [--file PATH] "Your message"

Examples:
  npm run smoke -- "Say hello"
  npm run smoke -- --stream --model deepseek-web-think "Explain SSE in one sentence"
  npm run smoke -- --mode Expert --temperature 0.2 --max-tokens 512 "Review this function"
  npm run smoke -- --json "Return { \\"status\\": \\"ok\\" }"
  npm run smoke -- --image ./scan.png "What text is in this image?"
  npm run smoke -- --file ./notes.txt "Summarize the attached file"

Environment variables:
  LOCAL_API_BASE_URL   Default: http://127.0.0.1:8787
  LOCAL_API_KEY        Bearer token for the local API
  DEEPSEEK_EMAIL       Optional password-first login email
  DEEPSEEK_PASSWORD    Optional password-first login password
  DEEPSEEK_LOCAL_MODEL Default: deepseek-web-chat
  DEEPSEEK_LOCAL_SYSTEM Optional system prompt
  DEEPSEEK_LOCAL_REASONING_MODE Optional Instant, Expert, or Vision
  DEEPSEEK_LOCAL_TEMPERATURE Optional temperature
  DEEPSEEK_LOCAL_TOP_P Optional top_p
  DEEPSEEK_LOCAL_MAX_TOKENS Optional max_tokens
  DEEPSEEK_LOCAL_CONTEXT_SIZE Optional context_size
  DEEPSEEK_TEST_MESSAGE Default message when no argument is provided

Behavior:
  The script checks /auth/status and automatically calls POST /auth/login/auto when the current session is not usable.
`.trim());
}

function numberOrNull(value) {
  if (value === '' || value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
