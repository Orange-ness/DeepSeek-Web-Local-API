import { UpstreamError } from './errors.js';

export function isFunctionCallingRequest(request) {
  return (
    (Array.isArray(request.tools) && request.tools.length > 0) ||
    request.messages.some(
      (message) =>
        message.role === 'tool' ||
        (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
    )
  );
}

export function buildFunctionCallingPrompt({
  messages,
  tools,
  toolChoice,
  parallelToolCalls = true,
  repairInstruction = ''
}) {
  const availableTools = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || '',
    parameters: tool.function.parameters || { type: 'object', properties: {} }
  }));

  const rules = [
    'You are operating inside an OpenAI-compatible function calling adapter.',
    'Respond with exactly one valid JSON object and no markdown or extra text.',
    'Allowed response format 1: {"type":"message","content":"plain text answer"}',
    'Allowed response format 2: {"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{...}}]}',
    'When returning "tool_calls", omit the "content" field or set it to an empty string.',
    'The "arguments" field must be a JSON object, not a string.',
    'Never invent tool names that are not listed in AVAILABLE_TOOLS.'
  ];

  if (!parallelToolCalls) {
    rules.push('Return at most one tool call.');
  }

  if (toolChoice === 'none' || availableTools.length === 0) {
    rules.push('No new tool call is allowed right now. You must return {"type":"message",...}.');
  } else if (toolChoice === 'required') {
    rules.push('You must return at least one tool call.');
  } else if (typeof toolChoice === 'object' && toolChoice?.function?.name) {
    rules.push(`You must return exactly one tool call named "${toolChoice.function.name}".`);
  } else {
    rules.push('If the answer requires external action or structured lookup, return tool_calls. Otherwise return a message.');
  }

  if (repairInstruction) {
    rules.push(`The previous attempt was invalid. Fix it strictly: ${repairInstruction}`);
  }

  return [
    rules.join('\n'),
    `AVAILABLE_TOOLS:\n${JSON.stringify(availableTools, null, 2)}`,
    `CONVERSATION:\n${renderConversation(messages)}`
  ].join('\n\n');
}

export function parseFunctionCallingResponse(
  text,
  { tools, toolChoice, parallelToolCalls = true } = {}
) {
  const payload = parseJsonObject(text);
  const toolNames = new Set((tools || []).map((tool) => tool.function.name));

  if (looksLikeMessagePayload(payload)) {
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (toolChoice === 'required') {
      throw new Error('The model returned a normal message even though a tool call was required.');
    }

    if (typeof toolChoice === 'object' && toolChoice?.function?.name) {
      throw new Error(`The model returned a normal message instead of calling "${toolChoice.function.name}".`);
    }

    return {
      type: 'message',
      content
    };
  }

  const rawToolCalls = extractRawToolCalls(payload);
  if (!rawToolCalls.length) {
    throw new Error('The model did not return a valid function calling JSON payload.');
  }

  if (!parallelToolCalls && rawToolCalls.length > 1) {
    throw new Error('The model returned multiple tool calls even though parallel_tool_calls is disabled.');
  }

  const toolCalls = rawToolCalls.map((toolCall) => {
    const name = toolCall?.name || toolCall?.function?.name;
    if (!name || !toolNames.has(name)) {
      throw new Error(`The model referenced an unknown tool "${name || 'unknown'}".`);
    }

    const rawArguments =
      toolCall?.arguments ??
      toolCall?.function?.arguments ??
      toolCall?.input ??
      toolCall?.params ??
      {};
    const argumentsObject = normalizeArgumentsObject(rawArguments);

    return {
      name,
      arguments: argumentsObject
    };
  });

  if (toolChoice === 'none') {
    throw new Error('The model returned tool calls even though tool_choice was "none".');
  }

  if (typeof toolChoice === 'object' && toolChoice?.function?.name) {
    if (toolCalls.length !== 1 || toolCalls[0].name !== toolChoice.function.name) {
      throw new Error(`The model must call exactly "${toolChoice.function.name}".`);
    }
  }

  return {
    type: 'tool_calls',
    tool_calls: toolCalls
  };
}

export function createFunctionCallingParseError(error, rawText) {
  return new UpstreamError('DeepSeek returned invalid function-calling JSON.', {
    statusCode: 502,
    code: 'upstream_invalid_tool_call',
    details: {
      validation_error: error?.message || String(error),
      raw_response_preview: String(rawText || '').slice(0, 4000)
    }
  });
}

function renderConversation(messages) {
  return messages
    .map((message) => {
      if (message.role === 'system') {
        return `[system]\n${message.content}`;
      }

      if (message.role === 'user') {
        return `[user]\n${message.content}`;
      }

      if (message.role === 'assistant') {
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          return [
            '[assistant_tool_calls]',
            JSON.stringify(
              message.tool_calls.map((toolCall) => ({
                id: toolCall.id || null,
                name: toolCall.function.name,
                arguments: safeJsonParse(toolCall.function.arguments)
              })),
              null,
              2
            ),
            message.content ? `[assistant_text]\n${message.content}` : ''
          ]
            .filter(Boolean)
            .join('\n');
        }

        return `[assistant]\n${message.content}`;
      }

      if (message.role === 'tool') {
        return [
          `[tool_result${message.tool_call_id ? `:${message.tool_call_id}` : ''}${message.name ? `:${message.name}` : ''}]`,
          message.content
        ].join('\n');
      }

      return `[message]\n${message.content}`;
    })
    .join('\n\n');
}

function looksLikeMessagePayload(payload) {
  return (
    payload?.type === 'message' ||
    (payload?.type !== 'tool_calls' &&
      !Array.isArray(payload?.tool_calls) &&
      typeof payload?.content === 'string')
  );
}

function extractRawToolCalls(payload) {
  if (payload?.type === 'tool_calls' && Array.isArray(payload.tool_calls)) {
    return payload.tool_calls;
  }

  if (Array.isArray(payload?.tool_calls)) {
    return payload.tool_calls;
  }

  if (payload?.name || payload?.function?.name) {
    return [payload];
  }

  return [];
}

function normalizeArgumentsObject(value) {
  if (typeof value === 'string') {
    const parsed = safeJsonParse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool call arguments must decode to a JSON object.');
    }

    return parsed;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool call arguments must be a JSON object.');
  }

  return value;
}

function parseJsonObject(text) {
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The model did not return valid JSON.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The model returned JSON, but not a JSON object.');
  }

  return payload;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
