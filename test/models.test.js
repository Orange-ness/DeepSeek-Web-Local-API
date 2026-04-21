import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenMessagesToPrompt,
  parseChatCompletionRequest,
  parseCleanupSessions,
  resolveModel
} from '../src/models.js';

test('parseChatCompletionRequest normalizes text arrays', () => {
  const parsed = parseChatCompletionRequest({
    model: 'deepseek-web-chat',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' }
        ]
      }
    ]
  });

  assert.equal(parsed.messages[0].content, 'hello world');
});

test('parseChatCompletionRequest accepts common OpenAI-compatible extra fields', () => {
  const parsed = parseChatCompletionRequest({
    model: 'deepseek-web-chat',
    stream: true,
    temperature: 0.2,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    n: 1,
    max_completion_tokens: 256,
    stop: ['</final>'],
    user: 'continue-user',
    stream_options: { include_usage: true },
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
    tool_choice: {
      type: 'function',
      function: { name: 'get_weather' }
    },
    messages: [
      { role: 'developer', content: 'You are a careful coding assistant.' },
      { role: 'user', content: 'Hello' }
    ]
  });

  assert.equal(parsed.max_tokens, 256);
  assert.equal(parsed.messages[0].role, 'system');
  assert.equal(parsed.messages[0].content, 'You are a careful coding assistant.');
  assert.equal(parsed.tools[0].function.name, 'get_weather');
  assert.deepEqual(parsed.tool_choice, {
    type: 'function',
    function: { name: 'get_weather' }
  });
});

test('parseChatCompletionRequest rejects unsupported message content', () => {
  assert.throws(() => {
    parseChatCompletionRequest({
      model: 'deepseek-web-chat',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'x' } }]
        }
      ]
    });
  });
});

test('parseChatCompletionRequest accepts tool call history messages', () => {
  const parsed = parseChatCompletionRequest({
    model: 'deepseek-web-chat',
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather'
        }
      }
    ],
    messages: [
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
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
        tool_call_id: 'call_123',
        content: '{"temperature_c":20}'
      }
    ]
  });

  assert.equal(parsed.messages[1].tool_calls[0].function.name, 'get_weather');
  assert.equal(parsed.messages[2].role, 'tool');
  assert.equal(parsed.messages[2].tool_call_id, 'call_123');
});

test('parseChatCompletionRequest rejects invalid n and unknown forced tools', () => {
  assert.throws(() => {
    parseChatCompletionRequest({
      model: 'deepseek-web-chat',
      n: 2,
      messages: [{ role: 'user', content: 'Hello' }]
    });
  });

  assert.throws(() => {
    parseChatCompletionRequest({
      model: 'deepseek-web-chat',
      tools: [{ type: 'function', function: { name: 'x' } }],
      tool_choice: {
        type: 'function',
        function: { name: 'missing' }
      },
      messages: [{ role: 'user', content: 'Hello' }]
    });
  });
});

test('resolveModel accepts DeepSeek aliases', () => {
  assert.deepEqual(resolveModel('deepseek-chat'), {
    publicModel: 'deepseek-web-chat',
    thinkingEnabled: false
  });

  assert.deepEqual(resolveModel('deepseek-reasoner'), {
    publicModel: 'deepseek-web-think',
    thinkingEnabled: true
  });
});

test('flattenMessagesToPrompt keeps role order deterministic', () => {
  const prompt = flattenMessagesToPrompt([
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Explain SSE.' },
    { role: 'assistant', content: 'SSE streams events.' },
    { role: 'user', content: 'In one sentence.' }
  ]);

  assert.match(prompt, /^Be concise\./);
  assert.match(prompt, /<｜User｜>Explain SSE\./);
  assert.match(prompt, /<｜Assistant｜>SSE streams events\.<｜end▁of▁sentence｜>/);
  assert.match(prompt, /<｜User｜>In one sentence\./);
});

test('parseCleanupSessions applies defaults and validates supported scopes', () => {
  assert.deepEqual(parseCleanupSessions({}), {
    scope: 'all',
    dry_run: false,
    keep_recent: 0,
    max_delete: 200
  });

  assert.throws(() => {
    parseCleanupSessions({ scope: 'invalid' });
  });
});
