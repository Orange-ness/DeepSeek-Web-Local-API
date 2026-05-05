import { UpstreamError } from './errors.js';

export function isFunctionCallingRequest(request) {
  return Array.isArray(request.tools) && request.tools.length > 0;
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
    'CRITICAL INSTRUCTION: You are a function-calling JSON adapter.',
    'Your ENTIRE response must be a single raw JSON object. No markdown, no explanation, no extra text.',
    'Do NOT wrap JSON in ```json``` code fences. Do NOT add any text before or after the JSON.',
    'Do NOT include any reasoning, thinking, or explanation. ONLY output the JSON object.',
    '',
    'Response format A (text answer):',
    '{"type":"message","content":"[Write your actual response text to the user here]"}',
    '',
    'Response format B (tool call):',
    '{"type":"tool_calls","tool_calls":[{"name":"tool_name","arguments":{...}}]}',
    '',
    'Rules:',
    '- The "arguments" field MUST be a JSON object, not a string.',
    '- Never invent tool names not in AVAILABLE_TOOLS.',
    '- When returning tool_calls, omit "content" or set it to "".'
  ];

  if (!parallelToolCalls) {
    rules.push('- Return at most one tool call.');
  }

  if (toolChoice === 'none' || availableTools.length === 0) {
    rules.push('- No tool calls allowed. You MUST return {"type":"message","content":"..."}.');
  } else if (toolChoice === 'required') {
    rules.push('- You MUST return at least one tool call. Do NOT return a message.');
  } else if (typeof toolChoice === 'object' && toolChoice?.function?.name) {
    rules.push(`- You MUST return exactly one tool call named "${toolChoice.function.name}".`);
  } else {
    rules.push('- If external action is needed, return tool_calls. Otherwise return a message.');
  }

  if (repairInstruction) {
    rules.push('');
    rules.push(`REPAIR: Your previous response was invalid. Error: ${repairInstruction}`);
    rules.push('Fix the issue and respond with ONLY the corrected JSON object.');
  }

  return [
    rules.join('\n'),
    `AVAILABLE_TOOLS:\n${JSON.stringify(availableTools, null, 2)}`,
    `CONVERSATION:\n${renderConversation(messages)}\n\n[assistant]`
  ].join('\n\n');
}

export function parseFunctionCallingResponse(
  text,
  { tools, toolChoice, parallelToolCalls = true } = {}
) {
  const payload = extractJsonObject(text);
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

/**
 * Robustly extract a JSON object from the model's response.
 * Handles: raw JSON, markdown code fences, JSON embedded in prose,
 * and thinking/reasoning preamble before the actual JSON.
 */
function extractJsonObject(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('The model returned an empty response.');
  }

  const trimmed = text.trim();

  // 1. Try direct parse first (ideal case)
  const directParse = tryParseJson(trimmed);
  if (directParse !== null && typeof directParse === 'object' && !Array.isArray(directParse)) {
    return directParse;
  }

  // 2. Extract from markdown code fences: ```json ... ``` or ``` ... ```
  const fencePatterns = [
    /```json\s*\n?([\s\S]*?)```/i,
    /```\s*\n?([\s\S]*?)```/
  ];

  for (const pattern of fencePatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const parsed = tryParseJson(match[1].trim());
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  }

  // 3. Find the outermost balanced { ... } in the text
  const extracted = extractOutermostBraces(trimmed);
  if (extracted) {
    const parsed = tryParseJson(extracted);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  // 4. Try finding the LAST balanced { ... } (sometimes the model outputs
  //    reasoning first, then the JSON at the end)
  const lastExtracted = extractLastBraces(trimmed);
  if (lastExtracted && lastExtracted !== extracted) {
    const parsed = tryParseJson(lastExtracted);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  // 5. Try aggressive cleanup: strip common prefixes/suffixes
  const cleaned = trimmed
    .replace(/^[\s\S]*?(?=\{)/u, '')    // strip everything before first {
    .replace(/\}[\s\S]*$/u, '}');        // strip everything after last }
  if (cleaned !== trimmed) {
    const parsed = tryParseJson(cleaned);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  throw new Error('The model did not return valid JSON. Could not extract a JSON object from the response.');
}

/**
 * Extract the first balanced { ... } substring from text.
 */
function extractOutermostBraces(text) {
  const start = text.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extract the last balanced { ... } substring from text.
 * Useful when model outputs reasoning before the JSON.
 */
function extractLastBraces(text) {
  let lastStart = -1;
  let searchFrom = text.length - 1;

  // Find the last '{' that starts a balanced block
  while (searchFrom >= 0) {
    const pos = text.lastIndexOf('{', searchFrom);
    if (pos === -1) {
      break;
    }

    // Try to find matching closing brace
    let depth = 0;
    let inString = false;
    let escape = false;
    let valid = false;

    for (let i = pos; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          lastStart = pos;
          valid = true;
          const candidate = text.slice(pos, i + 1);
          return candidate;
        }
      }
    }

    searchFrom = pos - 1;
  }

  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
