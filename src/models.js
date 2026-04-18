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
}).strict();

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.union([z.string(), z.array(textPartSchema).min(1)])
}).strict();

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
  metadata: z.record(z.string(), metadataValueSchema).optional(),
  response_format: responseFormatSchema.optional(),
  debug_upstream: z.boolean().optional().default(false)
}).strict();

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

const MODEL_ALIASES = new Map([
  ['deepseek-web-chat', { publicModel: 'deepseek-web-chat', thinkingEnabled: false }],
  ['deepseek-chat', { publicModel: 'deepseek-web-chat', thinkingEnabled: false }],
  ['deepseek-web-think', { publicModel: 'deepseek-web-think', thinkingEnabled: true }],
  ['deepseek-reasoner', { publicModel: 'deepseek-web-think', thinkingEnabled: true }]
]);

export function parseChatCompletionRequest(payload) {
  try {
    const parsed = chatCompletionRequestSchema.parse(payload);
    return {
      ...parsed,
      messages: parsed.messages.map((message) => ({
        role: message.role,
        content: normalizeMessageContent(message.content)
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

export function normalizeMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => part.text).join('');
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
