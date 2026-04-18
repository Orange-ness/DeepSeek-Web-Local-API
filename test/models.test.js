import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenMessagesToPrompt, parseChatCompletionRequest, resolveModel } from '../src/models.js';

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
