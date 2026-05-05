#!/usr/bin/env node

import { loadEnvFiles } from '../src/env.js';

loadEnvFiles();

const args = new Set(process.argv.slice(2));
const baseUrl = (process.env.LOCAL_API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const apiKey = process.env.LOCAL_API_KEY || '';
const authHeaders = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };
const startedAt = Date.now();
const results = [];

try {
  const autoLogin = await runStep('POST /auth/login/auto', async () => {
    const payload = {};
    if (process.env.DEEPSEEK_EMAIL && process.env.DEEPSEEK_PASSWORD) {
      payload.email = process.env.DEEPSEEK_EMAIL;
      payload.password = process.env.DEEPSEEK_PASSWORD;
    }

    const response = await requestJson('POST', '/auth/login/auto', payload);
    assert(response.authenticated === true, 'auto login should finish authenticated');
    return {
      strategy: response.strategy || null,
      last_login_mode: response.last_login_mode
    };
  });

  const health = await runStep('GET /health', async () => {
    const response = await requestJson('GET', '/health');
    assert(response.ok === true, 'health.ok should be true');
    assert(response.deepseek_session?.authenticated === true, 'DeepSeek session should be authenticated');
    assert(response.upstream?.reachable === true, 'DeepSeek upstream should be reachable');
    return {
      session: response.deepseek_session,
      upstream: response.upstream
    };
  });

  await runStep('GET /auth/status', async () => {
    const response = await requestJson('GET', '/auth/status');
    assert(response.authenticated === true, 'auth/status should report authenticated=true');
    return response;
  });

  await runStep('GET /auth/debug', async () => {
    const response = await requestJson('GET', '/auth/debug');
    assert(response.auth_token_present === true, 'auth/debug should report auth_token_present=true');
    assert(response.cookie_header_present === true, 'auth/debug should report cookie_header_present=true');
    return {
      session_usable: response.session_usable,
      has_configured_credentials: response.has_configured_credentials,
      header_keys: response.transport?.header_keys || []
    };
  });

  if (args.has('--browser-login')) {
    await runStep('POST /auth/login/browser', async () => {
      const response = await requestJson('POST', '/auth/login/browser');
      assert(response.authenticated === true, 'browser login should end authenticated');
      return response;
    });
  }

  if (args.has('--password-login')) {
    await runStep('POST /auth/login/password', async () => {
      const email = process.env.DEEPSEEK_EMAIL || '';
      const password = process.env.DEEPSEEK_PASSWORD || '';
      assert(email.length > 0, 'DEEPSEEK_EMAIL is required with --password-login');
      assert(password.length > 0, 'DEEPSEEK_PASSWORD is required with --password-login');

      const response = await requestJson('POST', '/auth/login/password', { email, password });
      assert(response.authenticated === true, 'password login should end authenticated');
      return response;
    });
  }

  await runStep('GET /v1/models', async () => {
    const response = await requestJson('GET', '/v1/models');
    const modelIds = new Set((response.data || []).map((model) => model.id));
    assert(modelIds.has('deepseek-web-chat'), 'models should include deepseek-web-chat');
    assert(modelIds.has('deepseek-web-think'), 'models should include deepseek-web-think');
    assert(modelIds.has('deepseek-web-expert'), 'models should include deepseek-web-expert');
    assert(modelIds.has('deepseek-web-vision'), 'models should include deepseek-web-vision');
    return { models: [...modelIds] };
  });

  await runStep('GET /v1/capabilities', async () => {
    const response = await requestJson('GET', '/v1/capabilities');
    const modeIds = new Set((response.reasoning_modes || []).map((mode) => mode.id));
    assert(modeIds.has('Instant'), 'capabilities should include Instant mode');
    assert(modeIds.has('Expert'), 'capabilities should include Expert mode');
    assert(modeIds.has('Vision'), 'capabilities should include Vision mode');
    assert(response.generation_parameters?.top_p?.maximum === 1, 'top_p range should be exposed');
    return {
      modes: [...modeIds],
      tool_calling: response.compatibility?.tool_calling
    };
  });

  const debugCompletion = await runStep('POST /v1/chat/completions non-stream alias', async () => {
    const { json, traceId } = await requestCompletion({
      model: 'deepseek-chat',
      stream: false,
      debug_upstream: true,
      messages: [
        { role: 'system', content: 'Reply in one short sentence.' },
        { role: 'user', content: 'Say that everything works.' }
      ]
    });

    const content = json?.choices?.[0]?.message?.content || '';
    assert(content.trim().length > 0, 'non-stream completion content should not be empty');
    assert(traceId, 'non-stream completion should return x-upstream-trace-id');
    return { preview: preview(content), traceId };
  });

  await runStep('GET /debug/upstream/:id', async () => {
    const response = await requestJson('GET', `/debug/upstream/${encodeURIComponent(debugCompletion.traceId)}`);
    assert(response?.id === debugCompletion.traceId, 'trace lookup should match the completion trace id');
    assert(Array.isArray(response?.steps), 'upstream trace should include steps');
    return {
      id: response.id,
      status: response.status,
      steps: response.steps.length
    };
  });

  await runStep('GET /debug/upstream/latest', async () => {
    const response = await requestJson('GET', '/debug/upstream/latest');
    assert(response?.id, 'latest upstream trace should exist');
    assert(Array.isArray(response?.steps), 'latest upstream trace should include steps');
    return {
      id: response.id,
      status: response.status,
      steps: response.steps.length,
      matches_debug_completion: response.id === debugCompletion.traceId
    };
  });

  await runStep('POST /v1/chat/completions stream', async () => {
    const { text, traceId } = await requestStream('/v1/chat/completions', {
      model: 'deepseek-web-chat',
      stream: true,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }]
    });

    assert(text.trim().length > 0, 'stream completion text should not be empty');
    assert(traceId, 'streaming completion should return x-upstream-trace-id');
    return { preview: preview(text), traceId };
  });

  await runStep('POST /v1/chat/completions think alias', async () => {
    const { json } = await requestCompletion({
      model: 'deepseek-reasoner',
      stream: false,
      messages: [{ role: 'user', content: 'Reply with one word: OK' }]
    });

    const content = json?.choices?.[0]?.message?.content || '';
    assert(content.trim().length > 0, 'think completion content should not be empty');
    return { preview: preview(content) };
  });

  await runStep('POST /v1/chat/completions advanced controls', async () => {
    const { json } = await requestCompletion({
      model: 'deepseek-web-chat',
      reasoning_mode: 'Expert',
      stream: false,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 512,
      context_size: 2,
      system_prompt: 'Reply as a terse code reviewer.',
      messages: [
        { role: 'user', content: 'Old request.' },
        { role: 'assistant', content: 'Old response.' },
        { role: 'user', content: 'Say OK if advanced controls work.' }
      ]
    });

    const content = json?.choices?.[0]?.message?.content || '';
    assert(content.trim().length > 0, 'advanced controls completion content should not be empty');
    return { preview: preview(content) };
  });

  await runStep('POST /v1/chat/completions json_object response_format', async () => {
    const { json } = await requestCompletion({
      model: 'deepseek-web-chat',
      stream: false,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return {"status":"ok"} and nothing else.' }]
    });

    const content = json?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    assert(parsed.status, 'json_object response should parse as JSON');
    return { preview: preview(content) };
  });

  await runStep('Validation error for unsupported content', async () => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        model: 'deepseek-web-chat',
        messages: [
          {
            role: 'user',
            content: [{ type: 'audio_url', audio_url: { url: 'https://example.com/audio.wav' } }]
          }
        ]
      })
    });

    const json = await response.json();
    assert(response.status === 400, `expected 400, got ${response.status}`);
    assert(json?.error?.type === 'bad_request', 'error.type should be bad_request');
    return {
      status: response.status,
      type: json.error.type
    };
  });

  await runStep('GET /metrics', async () => {
    const response = await requestJson('GET', '/metrics');
    assert(response?.http?.totalRequests > 0, 'metrics.http.totalRequests should be > 0');
    assert(response?.chat?.totalRequests > 0, 'metrics.chat.totalRequests should be > 0');
    return {
      total_requests: response.http.totalRequests,
      chat_requests: response.chat.totalRequests,
      queue_limit: response.queue?.limit || null
    };
  });

  printSummary(true, {
    elapsedMs: Date.now() - startedAt,
    autoLogin,
    health
  });
} catch (error) {
  printSummary(false, {
    elapsedMs: Date.now() - startedAt,
    error
  });
  process.exit(1);
}

async function runStep(name, fn) {
  const started = Date.now();

  try {
    const details = await fn();
    results.push({ name, ok: true, details, elapsedMs: Date.now() - started });
    printStep('PASS', name, details, Date.now() - started);
    return details;
  } catch (error) {
    results.push({ name, ok: false, error: error.message, elapsedMs: Date.now() - started });
    printStep('FAIL', name, { error: error.message }, Date.now() - started);
    throw error;
  }
}

async function requestJson(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? jsonHeaders : authHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

async function requestCompletion(payload) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`POST /v1/chat/completions failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  return {
    json,
    traceId: response.headers.get('x-upstream-trace-id')
  };
}

async function requestStream(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`POST ${path} stream failed with ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Streaming response body is missing.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

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
      text += extractTextFromSseBlock(block);
    }
  }

  if (buffer.trim()) {
    text += extractTextFromSseBlock(buffer);
  }

  return {
    text,
    traceId: response.headers.get('x-upstream-trace-id')
  };
}

function extractTextFromSseBlock(block) {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data || data === '[DONE]') {
    return '';
  }

  try {
    const payload = JSON.parse(data);
    return payload?.choices?.[0]?.delta?.content || '';
  } catch {
    return '';
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function preview(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function printStep(status, name, details, elapsedMs) {
  console.log(`${status} ${name} (${elapsedMs}ms)`);
  if (details && Object.keys(details).length > 0) {
    console.log(`  ${JSON.stringify(details)}`);
  }
}

function printSummary(ok, { elapsedMs, autoLogin, health, error }) {
  console.log('');
  console.log(ok ? 'Verification complete.' : 'Verification failed.');
  console.log(`Elapsed: ${elapsedMs}ms`);
  console.log(`Steps passed: ${results.filter((item) => item.ok).length}/${results.length}`);

  if (autoLogin) {
    console.log(`Auto login strategy: ${autoLogin.strategy || 'n/a'}`);
  }

  if (health) {
    console.log(`Session authenticated: ${health.session?.authenticated}`);
    console.log(`Upstream reachable: ${health.upstream?.reachable}`);
  }

  if (!ok && error) {
    console.log(`Failure: ${error.message}`);
  }
}
