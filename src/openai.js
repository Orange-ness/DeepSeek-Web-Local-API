import crypto from 'node:crypto';

export function createChatCompletionResponse({ id, model, content }) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content
        }
      }
    ]
  };
}

export function createChatCompletionChunk({ id, model, delta, done = false, includeRole = false }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          ...(includeRole ? { role: 'assistant' } : {}),
          ...(delta ? { content: delta } : {})
        },
        finish_reason: done ? 'stop' : null
      }
    ]
  };
}

export function createChatCompletionId() {
  return `chatcmpl-${crypto.randomUUID()}`;
}

export function toSseFrame(payload) {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
}
