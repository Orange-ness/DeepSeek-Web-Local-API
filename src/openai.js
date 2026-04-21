import crypto from 'node:crypto';

export function createChatCompletionResponse({ id, model, content, toolCalls }) {
  const normalizedToolCalls = normalizeToolCalls(toolCalls);
  const hasToolCalls = normalizedToolCalls.length > 0;

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content: hasToolCalls ? null : content,
          ...(hasToolCalls ? { tool_calls: normalizedToolCalls } : {})
        }
      }
    ]
  };
}

export function createChatCompletionChunk({
  id,
  model,
  delta,
  done = false,
  includeRole = false,
  finishReason,
  toolCalls
}) {
  const normalizedToolCalls = normalizeToolCallDeltas(toolCalls);

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
          ...(delta ? { content: delta } : {}),
          ...(normalizedToolCalls.length > 0 ? { tool_calls: normalizedToolCalls } : {})
        },
        finish_reason: done ? finishReason || 'stop' : null
      }
    ]
  };
}

export function createChatCompletionId() {
  return `chatcmpl-${crypto.randomUUID()}`;
}

export function createToolCallId() {
  return `call_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function createSyntheticChatCompletionFrames({ id, model, content, toolCalls }) {
  const normalizedToolCalls = normalizeToolCalls(toolCalls);
  const frames = [
    createChatCompletionChunk({
      id,
      model,
      includeRole: true
    })
  ];

  if (normalizedToolCalls.length > 0) {
    frames.push(
      createChatCompletionChunk({
        id,
        model,
        toolCalls: normalizedToolCalls,
        finishReason: null
      })
    );
    frames.push(
      createChatCompletionChunk({
        id,
        model,
        done: true,
        finishReason: 'tool_calls'
      })
    );
    return frames;
  }

  if (content) {
    frames.push(
      createChatCompletionChunk({
        id,
        model,
        delta: content
      })
    );
  }

  frames.push(
    createChatCompletionChunk({
      id,
      model,
      done: true,
      finishReason: 'stop'
    })
  );
  return frames;
}

export function toSseFrame(payload) {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id || createToolCallId(),
    type: 'function',
    function: {
      name: toolCall.name || toolCall.function?.name,
      arguments: normalizeArgumentsString(toolCall)
    }
  }));
}

function normalizeToolCallDeltas(toolCalls) {
  return normalizeToolCalls(toolCalls).map((toolCall, index) => ({
    index,
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments
    }
  }));
}

function normalizeArgumentsString(toolCall) {
  const rawArguments =
    toolCall.arguments !== undefined
      ? toolCall.arguments
      : toolCall.function?.arguments !== undefined
        ? toolCall.function.arguments
        : {};

  return typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments);
}
