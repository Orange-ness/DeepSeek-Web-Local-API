const decoder = new TextDecoder();

export async function* iterateSseEvents(stream) {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary === -1) {
        break;
      }

      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseBlock(block);
      if (event) {
        yield event;
      }
    }
  }

  buffer += decoder.decode();
  const tail = parseSseBlock(buffer);
  if (tail) {
    yield tail;
  }
}

export function createDeepSeekDeltaAssembler() {
  let assembled = '';
  let currentPatchPath = null;
  let wasThinking = false;

  return (payload) => {
    const nextPatchPath = payload?.p || payload?.data?.p || null;
    if (typeof nextPatchPath === 'string') {
      currentPatchPath = nextPatchPath;
    }

    const next = extractDeepSeekText(payload, currentPatchPath);
    if (!next) {
      return '';
    }

    let rawDelta = '';
    if (next.startsWith(assembled)) {
      rawDelta = next.slice(assembled.length);
      assembled = next;
    } else {
      rawDelta = next;
      assembled += next;
    }

    if (!rawDelta) {
      return '';
    }

    const isThinking = isThinkingPath(currentPatchPath);
    let formattedDelta = rawDelta;

    if (isThinking && !wasThinking) {
      formattedDelta = '<think>\n' + rawDelta;
      wasThinking = true;
    } else if (!isThinking && wasThinking) {
      formattedDelta = '\n</think>\n' + rawDelta;
      wasThinking = false;
    }

    return formattedDelta;
  };
}

export function extractDeepSeekText(payload, currentPatchPath = null) {
  const patchDelta = extractPatchDelta(payload, currentPatchPath);
  if (patchDelta) {
    return patchDelta;
  }

  const candidates = [
    payload?.v?.response?.fragments,
    payload?.data?.v?.response?.fragments,
    payload?.v?.response?.content,
    payload?.data?.v?.response?.content,
    payload?.data?.content,
    payload?.data?.data?.content,
    payload?.data?.delta?.content,
    payload?.choices?.[0]?.delta?.content,
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.data?.choices?.[0]?.delta?.content,
    payload?.data?.message?.content,
    payload?.message?.content,
    payload?.content,
    payload?.text
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function isThinkingPath(patchPath) {
  if (!patchPath) return false;
  const path = String(patchPath);
  return (
    path.startsWith('response/thinking') ||
    path.startsWith('response/search') ||
    path.startsWith('thinking') ||
    path.startsWith('search')
  );
}

function isTextPatchPath(patchPath) {
  if (!patchPath) return true;
  const path = String(patchPath);
  return (
    path.startsWith('response/thinking') ||
    path.startsWith('response/search') ||
    path.startsWith('thinking') ||
    path.startsWith('search') ||
    path.startsWith('response/content') ||
    path.startsWith('response/fragments') ||
    path.startsWith('content') ||
    path.startsWith('fragments')
  );
}

function extractPatchDelta(payload, currentPatchPath) {
  if (typeof payload?.v === 'string') {
    if (isTextPatchPath(currentPatchPath)) {
      return payload.v;
    }
  }

  if (typeof payload?.data?.v === 'string') {
    if (isTextPatchPath(currentPatchPath)) {
      return payload.data.v;
    }
  }

  return '';
}

function normalizeCandidate(candidate) {
  if (!candidate) {
    return '';
  }

  if (typeof candidate === 'string') {
    return candidate;
  }

  if (Array.isArray(candidate)) {
    return candidate
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item?.type === 'text' && typeof item.text === 'string') {
          return item.text;
        }

        if (typeof item?.content === 'string') {
          return item.content;
        }

        return '';
      })
      .join('');
  }

  return '';
}

function parseSseBlock(block) {
  if (!block.trim()) {
    return null;
  }

  const lines = block.split('\n');
  const dataLines = [];
  let eventType = 'message';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  return {
    event: eventType,
    data: dataLines.join('\n')
  };
}
