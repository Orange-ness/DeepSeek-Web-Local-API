import { QueueOverflowError, QueueTimeoutError, RequestAbortedError } from './errors.js';

export class AsyncSemaphore {
  constructor({ limit = 1, queueTimeoutMs = 30_000, maxQueueSize = 100 } = {}) {
    this.limit = Math.max(1, limit);
    this.queueTimeoutMs = Math.max(1, queueTimeoutMs);
    this.maxQueueSize = Math.max(1, maxQueueSize);
    this.active = 0;
    this.waiters = [];
  }

  async acquire({ signal, timeoutMs = this.queueTimeoutMs } = {}) {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }

    if (this.waiters.length >= this.maxQueueSize) {
      throw new QueueOverflowError();
    }

    return new Promise((resolve, reject) => {
      const waiter = () => {
        cleanup();
        this.active += 1;
        resolve(() => this.release());
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new QueueTimeoutError());
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        reject(new RequestAbortedError());
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.waiters = this.waiters.filter((entry) => entry !== waiter);
        signal?.removeEventListener?.('abort', onAbort);
      };

      if (signal?.aborted) {
        cleanup();
        reject(new RequestAbortedError());
        return;
      }

      signal?.addEventListener?.('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  async run(task, options = {}) {
    const release = await this.acquire(options);

    try {
      return await task();
    } finally {
      release();
    }
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }

  snapshot() {
    return {
      limit: this.limit,
      active: this.active,
      pending: this.waiters.length,
      queue_timeout_ms: this.queueTimeoutMs,
      max_queue_size: this.maxQueueSize
    };
  }
}
