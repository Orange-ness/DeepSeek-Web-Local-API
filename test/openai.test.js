import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticChatCompletionFrames } from '../src/openai.js';

test('createSyntheticChatCompletionFrames preserves existing tool call argument strings', () => {
  const frames = createSyntheticChatCompletionFrames({
    id: 'chatcmpl-test',
    model: 'deepseek-web-chat',
    toolCalls: [
      {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Brussels"}'
        }
      }
    ]
  });

  assert.equal(frames[1].choices[0].delta.tool_calls[0].function.arguments, '{"city":"Brussels"}');
  assert.equal(frames[2].choices[0].finish_reason, 'tool_calls');
});
