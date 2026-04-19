export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export function createDefaultTransportTemplate(config, overrides = {}) {
  const baseUrl = stripTrailingSlash(config.deepSeekBaseUrl);
  const chatOrigin = config.deepSeekOrigin;
  const userAgent = overrides.userAgent || DEFAULT_USER_AGENT;
  const dsPow = overrides.dsPowResponse ?? config.deepSeekDsPowResponse;

  return {
    source: overrides.source || 'fallback-defaults',
    capturedAt: overrides.capturedAt || null,
    baseUrl,
    createChatSessionUrl: overrides.createChatSessionUrl || `${baseUrl}/chat_session/create`,
    deleteChatSessionUrl: overrides.deleteChatSessionUrl || `${baseUrl}/chat_session/delete`,
    chatCompletionUrl: overrides.chatCompletionUrl || `${baseUrl}/chat/completion`,
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      origin: chatOrigin,
      referer: `${chatOrigin}/`,
      'user-agent': userAgent,
      'x-app-version': overrides.appVersion || '20241129.1',
      'x-client-locale': overrides.clientLocale || 'en_US',
      'x-client-platform': 'web',
      'x-client-version': overrides.clientVersion || '1.0.0-always',
      ...(dsPow ? { 'x-ds-pow-response': dsPow } : {})
    }
  };
}

export function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
