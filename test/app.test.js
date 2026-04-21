import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { resolveConfig } from '../src/config.js';
import { DeepSeekWebClient } from '../src/deepseek/client.js';

test('health reports authenticated session and upstream reachability', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'GET',
    url: '/health'
  });

  const payload = response.json();
  assert.equal(response.statusCode, 200);
  assert.equal(payload.deepseek_session.authenticated, true);
  assert.equal(payload.upstream.reachable, true);

  await app.close();
});

test('non-stream chat completion buffers upstream SSE', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].message.content, 'Hello from the fake upstream');

  await app.close();
});

test('chat completion uploads parseable file attachments and forwards ref_file_ids', async () => {
  const app = buildTestApp();
  const textDataUrl = `data:text/plain;base64,${Buffer.from('The animal is a cat.', 'utf8').toString('base64')}`;

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What animal is mentioned in the file?' },
            {
              type: 'input_file',
              input_file: {
                filename: 'note.txt',
                file_data: textDataUrl
              }
            }
          ]
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].message.content, 'Hello from the fake upstream');

  const uploadRequest = app.requestLog.find((entry) => entry.url === `${app.testBaseUrl}/file/upload_file`);
  assert.equal(Boolean(uploadRequest), true);
  assert.match(String(uploadRequest.headers?.['content-type'] || ''), /multipart\/form-data/u);

  const completionRequest = app.requestLog.find((entry) => entry.url === `${app.testBaseUrl}/chat/completion`);
  assert.deepEqual(completionRequest.parsedBody?.ref_file_ids, ['file-1']);

  await app.close();
});

test('chat completion fails early when DeepSeek cannot parse an attachment', async () => {
  const app = buildTestApp({
    uploadedFileFinalStatus: 'CONTENT_EMPTY'
  });
  const imageDataUrl = `data:image/png;base64,${Buffer.from('fake-image').toString('base64')}`;

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
                filename: 'image.png'
              }
            }
          ]
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /could not use attachment/i);
  assert.equal(
    app.requestLog.some((entry) => entry.url === `${app.testBaseUrl}/chat/completion`),
    false
  );

  await app.close();
});

test('streaming chat completion emits OpenAI-style SSE', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      stream: true,
      messages: [{ role: 'user', content: 'Hello' }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /chat\.completion\.chunk/);
  assert.match(response.body, /"content":"Hello"/);
  assert.match(response.body, /"content":" from the fake upstream"/);
  assert.match(response.body, /\[DONE\]/);

  await app.close();
});

test('chat completion surfaces upstream auth failures', async () => {
  const app = buildTestApp({ errorStatus: 401 });

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.type, 'upstream_401');

  await app.close();
});

test('chat completion surfaces upstream rate limiting', async () => {
  const app = buildTestApp({ errorStatus: 429 });

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-think',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.type, 'upstream_429');

  await app.close();
});

test('chat completion maps upstream 5xx to bad gateway', async () => {
  const app = buildTestApp({ errorStatus: 500 });

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.type, 'upstream_500');

  await app.close();
});

test('non-stream function calling returns OpenAI-style tool_calls', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' }
              }
            }
          }
        }
      ],
      messages: [{ role: 'user', content: 'What is the weather in Brussels?' }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].finish_reason, 'tool_calls');
  assert.equal(response.json().choices[0].message.content, null);
  assert.equal(response.json().choices[0].message.tool_calls[0].function.name, 'get_weather');
  assert.equal(
    response.json().choices[0].message.tool_calls[0].function.arguments,
    '{"city":"Brussels"}'
  );

  await app.close();
});

test('streaming function calling emits tool_calls chunks', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      stream: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' }
              }
            }
          }
        }
      ],
      messages: [{ role: 'user', content: 'What is the weather in Brussels?' }]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"tool_calls"/);
  assert.match(response.body, /"name":"get_weather"/);
  assert.match(response.body, /"finish_reason":"tool_calls"/);
  assert.match(response.body, /\[DONE\]/);

  await app.close();
});

test('function calling follow-up can turn tool results into a final answer', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' }
              }
            }
          }
        }
      ],
      messages: [
        { role: 'user', content: 'What is the weather in Brussels?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_weather',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"Brussels"}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_weather',
          content: '{"temperature_c":20,"condition":"sunny"}'
        },
        {
          role: 'user',
          content: 'Now answer for the user in one sentence.'
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().choices[0].finish_reason, 'stop');
  assert.match(response.json().choices[0].message.content, /Brussels/i);

  await app.close();
});

test('auth debug and metrics expose the new diagnostics', async () => {
  const app = buildTestApp();

  await app.ready();
  const authDebug = await app.inject({
    method: 'GET',
    url: '/auth/debug'
  });
  const metrics = await app.inject({
    method: 'GET',
    url: '/metrics'
  });

  assert.equal(authDebug.statusCode, 200);
  assert.equal(authDebug.json().auth_token_present, true);
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json().http.totalRequests >= 1, true);

  await app.close();
});

test('upstream trace endpoints expose trace ids from chat completions', async () => {
  const app = buildTestApp();

  await app.ready();
  const completion = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      messages: [{ role: 'user', content: 'Hello' }],
      debug_upstream: true
    }
  });

  assert.equal(completion.statusCode, 200);
  const traceId = completion.headers['x-upstream-trace-id'];
  assert.equal(typeof traceId, 'string');
  assert.equal(traceId.length > 0, true);

  const latestTrace = await app.inject({
    method: 'GET',
    url: '/debug/upstream/latest'
  });
  const traceById = await app.inject({
    method: 'GET',
    url: `/debug/upstream/${traceId}`
  });

  assert.equal(latestTrace.statusCode, 200);
  assert.equal(traceById.statusCode, 200);
  assert.equal(latestTrace.json().id, traceId);
  assert.equal(traceById.json().id, traceId);
  assert.equal(Array.isArray(traceById.json().steps), true);

  await app.close();
});

test('chat completions delete upstream chat sessions after the reply', async () => {
  const app = buildTestApp();

  await app.ready();
  await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'deepseek-web-chat',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  });

  await waitFor(() =>
    app.requestLog.some((entry) =>
      entry.url === `${app.testBaseUrl}/chat_session/delete` &&
      entry.method === 'POST' &&
      entry.body === JSON.stringify({ chat_session_id: 'session-123' })
    )
  );

  await app.close();
});

test('manual cleanup endpoint deletes remote chat sessions', async () => {
  const app = buildTestApp();

  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/debug/cleanup-sessions',
    payload: {
      scope: 'all',
      keep_recent: 1,
      max_delete: 10
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().scope, 'all');
  assert.equal(response.json().deleted_count, 2);
  assert.equal(response.json().keep_recent, 1);
  assert.equal(app.remoteSessions.length, 1);

  await app.close();
});

test('startup cleanup deletes tracked orphan sessions only', async () => {
  const app = buildTestApp({
    trackedEntries: [
      { id: 'tracked-orphan-1', created_at: new Date().toISOString(), source: 'api' },
      { id: 'tracked-orphan-2', created_at: new Date().toISOString(), source: 'api' }
    ],
    remoteSessions: [
      { id: 'tracked-orphan-1', seq_id: 4, title: 'Tracked orphan one', title_type: 'SYSTEM', updated_at: 4 },
      { id: 'tracked-orphan-2', seq_id: 3, title: 'Tracked orphan two', title_type: 'SYSTEM', updated_at: 3 },
      { id: 'keep-manual-1', seq_id: 2, title: 'Keep me', title_type: 'SYSTEM', updated_at: 2 }
    ]
  });

  await app.ready();
  const summary = await app.deepSeekService.cleanupTrackedStartupSessions();

  assert.equal(summary.scope, 'tracked');
  assert.equal(summary.deleted_count, 2);
  assert.equal(summary.tracked_remaining_count, 0);
  assert.deepEqual(
    app.remoteSessions.map((item) => item.id),
    ['keep-manual-1']
  );

  await app.close();
});

function buildTestApp({
  errorStatus = null,
  trackedEntries,
  remoteSessions,
  uploadedFileFinalStatus = 'SUCCESS'
} = {}) {
  const baseUrl = 'https://fake.deepseek.local/api/v0';
  const requestLog = [];
  const pendingEntries = [...(trackedEntries || [])];
  const upstreamSessions = [
    ...(remoteSessions || [
      { id: 'keep-recent-1', seq_id: 3, title: 'Keep recent', title_type: 'SYSTEM', updated_at: 3 },
      { id: 'cleanup-old-1', seq_id: 2, title: 'Cleanup one', title_type: 'SYSTEM', updated_at: 2 },
      { id: 'cleanup-old-2', seq_id: 1, title: 'Cleanup two', title_type: 'SYSTEM', updated_at: 1 }
    ])
  ];
  const config = resolveConfig({
    HOST: '127.0.0.1',
    PORT: '8787',
    DATA_DIR: '.deepseek-web-api-test',
    DEEPSEEK_BASE_URL: baseUrl
  });

  const session = {
    authenticated: true,
    lastLoginMode: 'browser',
    updatedAt: new Date().toISOString(),
    expiresAt: null,
    authToken: 'test-token',
    cookieHeader: 'cf_clearance=ok',
    transport: {
      baseUrl,
      createChatSessionUrl: `${baseUrl}/chat_session/create`,
      deleteChatSessionUrl: `${baseUrl}/chat_session/delete`,
      chatCompletionUrl: `${baseUrl}/chat/completion`,
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        origin: baseUrl,
        referer: baseUrl,
        'user-agent': 'test-agent'
      }
    }
  };

  const sessionManager = {
    store: {
      async load() {
        return session;
      }
    },
    async getStatus() {
      return {
        authenticated: true,
        expires_at: null,
        last_login_mode: 'browser',
        updated_at: session.updatedAt,
        transport_source: 'test'
      };
    },
    async requireSession() {
      return session;
    },
    async loginWithBrowser() {
      return this.getStatus();
    },
    async loginWithPassword() {
      return this.getStatus();
    },
    async loginAuto() {
      return {
        ...(await this.getStatus()),
        strategy: 'existing-session'
      };
    },
    async refreshSession() {
      return {
        ...(await this.getStatus()),
        strategy: 'existing-session',
        refresh_reason: 'test'
      };
    },
    async getDebugInfo() {
      return {
        ...(await this.getStatus()),
        session_present: true,
        auth_token_present: true,
        cookie_header_present: true,
        cookie_names: ['cf_clearance'],
        local_storage_keys: ['userToken'],
        transport: {
          source: 'test',
          captured_at: null,
          base_url: baseUrl,
          create_chat_session_url: `${baseUrl}/chat_session/create`,
          delete_chat_session_url: `${baseUrl}/chat_session/delete`,
          chat_completion_url: `${baseUrl}/chat/completion`,
          header_keys: ['accept', 'content-type', 'origin', 'referer', 'user-agent']
        }
      };
    },
    async logout() {
      return {
        authenticated: false,
        expires_at: null,
        last_login_mode: null,
        updated_at: null,
        transport_source: null
      };
    }
  };

  const pendingChatSessionStore = {
    async list() {
      return pendingEntries.map((entry) => ({ ...entry }));
    },
    async add(entry) {
      const existingIndex = pendingEntries.findIndex((item) => item.id === entry.id);
      if (existingIndex === -1) {
        pendingEntries.push({ ...entry });
      } else {
        pendingEntries[existingIndex] = { ...pendingEntries[existingIndex], ...entry };
      }
      return entry;
    },
    async remove(id) {
      const index = pendingEntries.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        pendingEntries.splice(index, 1);
      }
      return pendingEntries;
    }
  };

  const app = buildApp({
    config,
    sessionManager,
    client: new DeepSeekWebClient(config, {
      fetchImpl: createFakeFetch({
        baseUrl,
        errorStatus,
        requestLog,
        remoteSessions: upstreamSessions,
        uploadedFileFinalStatus
      }),
      pendingChatSessionStore,
      powResponseBuilder: async () => 'fake-pow'
    })
  });

  app.requestLog = requestLog;
  app.testBaseUrl = baseUrl;
  app.remoteSessions = upstreamSessions;
  app.pendingEntries = pendingEntries;
  return app;
}

function createFakeFetch({ baseUrl, errorStatus, requestLog, remoteSessions, uploadedFileFinalStatus }) {
  const uploadedFiles = new Map();
  let uploadedFileCount = 0;

  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? init.body : null;
    const parsedBody = body ? safeJsonParse(body) : null;
    const headers = normalizeHeaders(init.headers);

    requestLog.push({
      url,
      method,
      body,
      headers,
      parsedBody
    });

    if (url === 'https://fake.deepseek.local/') {
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    }

    if (url === `${baseUrl}/chat_session/create` && method === 'POST') {
      if (!remoteSessions.some((item) => item.id === 'session-123')) {
        remoteSessions.unshift({
          id: 'session-123',
          seq_id: 999,
          title: 'Session created by API',
          title_type: 'SYSTEM',
          updated_at: 999
        });
      }

      return new Response(JSON.stringify({ data: { biz_data: { id: 'session-123' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url === `${baseUrl}/chat_session/fetch_page?lte_cursor.pinned=false` && method === 'GET') {
      return new Response(JSON.stringify({
        code: 0,
        msg: '',
        data: {
          biz_code: 0,
          biz_msg: '',
          biz_data: {
            chat_sessions: remoteSessions,
            has_more: false
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url === `${baseUrl}/chat_session/delete` && method === 'POST') {
      const payload = body ? JSON.parse(body) : {};
      const index = remoteSessions.findIndex((item) => item.id === payload.chat_session_id);
      if (index >= 0) {
        remoteSessions.splice(index, 1);
      }

      return new Response(JSON.stringify({ code: 0, data: { biz_code: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url === `${baseUrl}/file/upload_file` && method === 'POST') {
      const fileId = `file-${++uploadedFileCount}`;
      uploadedFiles.set(fileId, {
        status: 'PENDING',
        fetchCount: 0,
        finalStatus: uploadedFileFinalStatus
      });

      return new Response(JSON.stringify({
        code: 0,
        msg: '',
        data: {
          biz_code: 0,
          biz_msg: '',
          biz_data: {
            id: fileId,
            status: 'PENDING',
            file_name: extractMultipartFileName(init.body) || `upload-${uploadedFileCount}.txt`,
            previewable: false,
            file_size: 16,
            token_usage: null,
            error_code: null,
            inserted_at: 1,
            updated_at: 1
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url.startsWith(`${baseUrl}/file/fetch_files?file_ids=`) && method === 'GET') {
      const fileId = new URL(url).searchParams.get('file_ids');
      const file = uploadedFiles.get(fileId);
      if (!file) {
        return new Response('missing file', { status: 404 });
      }

      file.fetchCount += 1;
      file.status = file.fetchCount === 1 ? 'PARSING' : file.finalStatus;

      return new Response(JSON.stringify({
        code: 0,
        msg: '',
        data: {
          biz_code: 0,
          biz_msg: '',
          biz_data: {
            files: [
              {
                id: fileId,
                status: file.status,
                file_name: 'uploaded-file',
                previewable: true,
                file_size: 16,
                token_usage: file.status === 'SUCCESS' ? 9 : 0,
                error_code: null,
                inserted_at: 1,
                updated_at: 2
              }
            ]
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url === 'https://chat.deepseek.com/api/v0/chat/create_pow_challenge' && method === 'POST') {
      return new Response(JSON.stringify({
        data: {
          biz_data: {
            challenge: {
              algorithm: 'DeepSeekHashV1',
              challenge: 'abc',
              salt: 'salt',
              signature: 'sig',
              difficulty: 1,
              expire_at: 1
            }
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url === `${baseUrl}/chat/completion` && method === 'POST') {
      if (errorStatus) {
        return new Response(JSON.stringify({ error: `status-${errorStatus}` }), {
          status: errorStatus,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (parsedBody?.prompt?.includes('OpenAI-compatible function calling adapter')) {
        const toolResponse = parsedBody.prompt.includes('[tool_result')
          ? '{"type":"message","content":"The weather in Brussels is 20C and sunny."}'
          : '{"type":"tool_calls","tool_calls":[{"name":"get_weather","arguments":{"city":"Brussels"}}]}';
        const halfway = Math.max(1, Math.floor(toolResponse.length / 2));
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: ready\ndata: {"request_message_id":1,"response_message_id":2}\n\n'));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: toolResponse.slice(0, halfway) })}\n\n`)
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: toolResponse })}\n\n`)
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        });

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' }
        });
      }

      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: ready\ndata: {"request_message_id":1,"response_message_id":2}\n\n'));
          controller.enqueue(encoder.encode('data: {"p":"response/content","o":"APPEND","v":"Hello"}\n\n'));
          controller.enqueue(encoder.encode('data: {"v":" from the fake upstream"}\n\n'));
          controller.enqueue(encoder.encode('data: {"p":"response/status","v":"FINISHED"}\n\n'));
          controller.enqueue(encoder.encode('event: title\ndata: {"content":"Metadata title that should be ignored"}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      });

      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' }
      });
    }

    return new Response('not found', { status: 404 });
  };
}

const encoder = new TextEncoder();

function normalizeHeaders(value) {
  if (!value) {
    return {};
  }

  if (typeof value.entries === 'function') {
    return Object.fromEntries(value.entries());
  }

  return Object.fromEntries(Object.entries(value));
}

function extractMultipartFileName(body) {
  if (!Buffer.isBuffer(body)) {
    return null;
  }

  const match = body.toString('utf8', 0, Math.min(body.length, 1024)).match(/filename="([^"]+)"/u);
  return match?.[1] || null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Timed out while waiting for the expected condition.');
}
