import crypto from 'node:crypto';

export class UpstreamTraceStore {
  constructor({ maxTraces = 20, maxEventsPerTrace = 64, maxTextPreviewChars = 16000 } = {}) {
    this.maxTraces = maxTraces;
    this.maxEventsPerTrace = maxEventsPerTrace;
    this.maxTextPreviewChars = maxTextPreviewChars;
    this.traces = [];
  }

  start(meta = {}) {
    const trace = {
      id: `trace-${crypto.randomUUID()}`,
      started_at: new Date().toISOString(),
      finished_at: null,
      meta,
      steps: [],
      sse_events: [],
      response_preview: '',
      status: 'running'
    };

    this.traces.unshift(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces.length = this.maxTraces;
    }

    return trace;
  }

  recordStep(trace, step) {
    if (!trace) {
      return;
    }

    trace.steps.push({
      at: new Date().toISOString(),
      ...step
    });
  }

  recordSseEvent(trace, event) {
    if (!trace) {
      return;
    }

    if (trace.sse_events.length >= this.maxEventsPerTrace) {
      return;
    }

    trace.sse_events.push({
      at: new Date().toISOString(),
      event: event.event,
      data_preview: truncate(event.data, 500)
    });
  }

  appendResponsePreview(trace, text) {
    if (!trace || !text) {
      return;
    }

    const remaining = this.maxTextPreviewChars - trace.response_preview.length;
    if (remaining <= 0) {
      return;
    }

    trace.response_preview += text.slice(0, remaining);
  }

  finish(trace, details = {}) {
    if (!trace) {
      return;
    }

    trace.finished_at = new Date().toISOString();
    trace.status = details.status || 'completed';
    trace.result = details.result || null;
    trace.error = details.error || null;
  }

  getLatest() {
    return clone(this.traces[0] || null);
  }

  getById(id) {
    return clone(this.traces.find((trace) => trace.id === id) || null);
  }

  snapshot() {
    return {
      count: this.traces.length,
      latest_trace_id: this.traces[0]?.id || null
    };
  }
}

function truncate(value, maxLength) {
  const text = String(value || '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function clone(value) {
  if (!value) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}
