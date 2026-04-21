import { z } from 'zod';
import { BadRequestError } from './errors.js';

export const PUBLIC_MODELS = [
  {
    id: 'deepseek-web-chat',
    object: 'model',
    created: 0,
    owned_by: 'deepseek-web'
  },
  {
    id: 'deepseek-web-think',
    object: 'model',
    created: 0,
    owned_by: 'deepseek-web'
  }
];

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string()
}).passthrough();

const declaredFunctionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.object({}).passthrough().optional()
}).passthrough();

const declaredToolSchema = z.object({
  type: z.literal('function'),
  function: declaredFunctionSchema
}).passthrough();

const assistantToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal('function').optional().default('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string()
  }).passthrough()
}).passthrough();

const chatMessageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.null(), z.array(textPartSchema).min(1)]).optional().default(''),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(assistantToolCallSchema).optional()
}).passthrough();

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const responseFormatSchema = z.object({
  type: z.enum(['text', 'json_object'])
}).strict();

export const chatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(chatMessageSchema).min(1),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  top_p: z.number().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  n: z.number().int().positive().optional(),
  user: z.string().optional(),
  stream_options: z.object({
    include_usage: z.boolean().optional()
  }).passthrough().optional(),
  seed: z.number().int().optional(),
  store: z.boolean().optional(),
  reasoning_effort: z.string().optional(),
  service_tier: z.string().optional(),
  parallel_tool_calls: z.boolean().optional(),
  tool_choice: z.union([
    z.enum(['none', 'auto', 'required']),
    z.object({
      type: z.literal('function'),
      function: z.object({
        name: z.string().min(1)
      }).passthrough()
    }).passthrough()
  ]).optional(),
  function_call: z.union([
    z.enum(['none', 'auto']),
    z.object({
      name: z.string().min(1)
    }).passthrough()
  ]).optional(),
  tools: z.array(declaredToolSchema).optional(),
  functions: z.array(declaredFunctionSchema).optional(),
  modalities: z.array(z.string()).optional(),
  audio: z.object({}).passthrough().optional(),
  prediction: z.object({}).passthrough().optional(),
  web_search_options: z.object({}).passthrough().optional(),
  logprobs: z.union([z.boolean(), z.number().int().nonnegative()]).optional(),
  top_logprobs: z.number().int().nonnegative().optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
  metadata: z.record(z.string(), metadataValueSchema).optional(),
  response_format: responseFormatSchema.optional(),
  debug_upstream: z.boolean().optional().default(false)
}).passthrough();

export const passwordLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1)
}).strict();

export const autoLoginSchema = z.object({
  email: z.email().optional(),
  password: z.string().min(1).optional(),
  force: z.boolean().optional().default(false),
  prefer_browser: z.boolean().optional().default(false),
  browser_fallback: z.boolean().optional().default(true)
}).strict().superRefine((value, context) => {
  const hasEmail = Boolean(value.email);
  const hasPassword = Boolean(value.password);

  if (hasEmail !== hasPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'email and password must either both be provided or both be omitted.'
    });
  }
});

export const cleanupSessionsSchema = z.object({
  scope: z.enum(['tracked', 'all']).optional().default('all'),
  dry_run: z.boolean().optional().default(false),
  keep_recent: z.number().int().min(0).optional().default(0),
  max_delete: z.number().int().positive().optional().default(200)
}).strict();

const MODEL_ALIASES = new Map([
  ['deepseek-web-chat', { publicModel: 'deepseek-web-chat', thinkingEnabled: false }],
  ['deepseek-chat', { publicModel: 'deepseek-web-chat', thinkingEnabled: false }],
  ['deepseek-web-think', { publicModel: 'deepseek-web-think', thinkingEnabled: true }],
  ['deepseek-reasoner', { publicModel: 'deepseek-web-think', thinkingEnabled: true }]
]);

export function parseChatCompletionRequest(payload) {
  try {
    const parsed = chatCompletionRequestSchema.parse(payload);
    const normalizedTools = normalizeDeclaredTools(parsed);
    const normalizedToolChoice = normalizeToolChoice(parsed, normalizedTools);
    validateIgnoredChatFields(parsed, normalizedTools, normalizedToolChoice);
    return {
      ...parsed,
      max_tokens: parsed.max_tokens ?? parsed.max_completion_tokens,
      tools: normalizedTools,
      tool_choice: normalizedToolChoice,
      messages: parsed.messages.map((message) => ({
        role: normalizeMessageRole(message.role),
        content: normalizeMessageContent(message.content),
        ...(message.name ? { name: message.name } : {}),
        ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
        ...(message.tool_calls
          ? {
              tool_calls: message.tool_calls.map((toolCall) => ({
                id: toolCall.id || null,
                type: 'function',
                function: {
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments
                }
              }))
            }
          : {})
      }))
    };
  } catch (error) {
    throw new BadRequestError('Invalid chat completion payload.', error.issues ?? error.message);
  }
}

export function parsePasswordLogin(payload) {
  try {
    return passwordLoginSchema.parse(payload);
  } catch (error) {
    throw new BadRequestError('Invalid login payload.', error.issues ?? error.message);
  }
}

export function parseAutoLogin(payload) {
  try {
    return autoLoginSchema.parse(payload);
  } catch (error) {
    throw new BadRequestError('Invalid auto-login payload.', error.issues ?? error.message);
  }
}

export function resolveModel(model) {
  const resolved = MODEL_ALIASES.get(model);
  if (!resolved) {
    throw new BadRequestError(`Unsupported model "${model}".`);
  }

  return resolved;
}

export function parseCleanupSessions(payload) {
  try {
    return cleanupSessionsSchema.parse(payload || {});
  } catch (error) {
    throw new BadRequestError('Invalid cleanup payload.', error.issues ?? error.message);
  }
}

export function normalizeMessageContent(content) {
  if (content == null) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => part.text).join('');
}

function normalizeMessageRole(role) {
  return role === 'developer' ? 'system' : role;
}

function normalizeDeclaredTools(payload) {
  const declaredTools = Array.isArray(payload.tools) ? payload.tools : [];
  const legacyFunctions = Array.isArray(payload.functions)
    ? payload.functions.map((item) => ({
        type: 'function',
        function: item
      }))
    : [];
  const tools = [...declaredTools, ...legacyFunctions].map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}),
      parameters: tool.function.parameters || { type: 'object', properties: {} }
    }
  }));
  const names = new Set();

  for (const tool of tools) {
    if (names.has(tool.function.name)) {
      throw new BadRequestError(`Duplicate tool name "${tool.function.name}" is not supported.`);
    }

    names.add(tool.function.name);
  }

  return tools;
}

function normalizeToolChoice(payload, tools) {
  const toolNames = new Set(tools.map((tool) => tool.function.name));
  let normalized = payload.tool_choice;

  if (!normalized && payload.function_call) {
    normalized =
      typeof payload.function_call === 'string'
        ? payload.function_call
        : {
            type: 'function',
            function: {
              name: payload.function_call.name
            }
          };
  }

  if (!normalized) {
    return tools.length > 0 ? 'auto' : 'none';
  }

  if (typeof normalized === 'string') {
    return normalized;
  }

  if (!toolNames.has(normalized.function.name)) {
    throw new BadRequestError(`Unknown tool "${normalized.function.name}" requested in tool_choice.`);
  }

  return {
    type: 'function',
    function: {
      name: normalized.function.name
    }
  };
}

function validateIgnoredChatFields(payload, tools, toolChoice) {
  if (payload.n !== undefined && payload.n !== 1) {
    throw new BadRequestError('Only n=1 is supported for chat completions.');
  }

  if (!tools.length && toolChoice === 'required') {
    throw new BadRequestError('tool_choice="required" requires at least one declared tool.');
  }

  if (Array.isArray(payload.modalities) && payload.modalities.some((item) => item !== 'text')) {
    throw new BadRequestError('Only text modality is supported.');
  }

  if (payload.audio) {
    throw new BadRequestError('Audio output is not supported.');
  }
}

export function flattenMessagesToPrompt(messages, { responseFormat } = {}) {
  if (!messages.length) {
    return '';
  }

  const mergedBlocks = [];
  let current = { ...messages[0] };

  for (let index = 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === current.role) {
      current.content += `\n\n${message.content}`;
      continue;
    }

    mergedBlocks.push(current);
    current = { ...message };
  }

  mergedBlocks.push(current);

  let prompt = mergedBlocks
    .map((block, index) => {
      if (block.role === 'assistant') {
        return `<｜Assistant｜>${block.content}<｜end▁of▁sentence｜>`;
      }

      if (block.role === 'user' || block.role === 'system') {
        return index > 0 ? `<｜User｜>${block.content}` : block.content;
      }

      return block.content;
    })
    .join('')
    .replace(/\!\[.+\]\(.+\)/g, '');

  if (responseFormat?.type === 'json_object') {
    prompt += '<｜User｜>Return only a valid JSON object.';
  }

  return prompt;
}
