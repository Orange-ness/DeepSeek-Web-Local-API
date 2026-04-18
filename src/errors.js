export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'internal_error', details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message, details) {
    super(message, { statusCode: 400, code: 'bad_request', details });
  }
}

export class AuthenticationRequiredError extends AppError {
  constructor(message = 'DeepSeek session is not authenticated.') {
    super(message, { statusCode: 401, code: 'authentication_required' });
  }
}

export class LocalApiAuthError extends AppError {
  constructor(message = 'Missing or invalid local API key.') {
    super(message, { statusCode: 401, code: 'local_api_auth_failed' });
  }
}

export class LoginTimeoutError extends AppError {
  constructor(message = 'Timed out while waiting for DeepSeek login to complete.') {
    super(message, { statusCode: 408, code: 'login_timeout' });
  }
}

export class UpstreamError extends AppError {
  constructor(message, { statusCode = 502, code = 'upstream_error', details } = {}) {
    super(message, { statusCode, code, details });
  }
}

export class QueueTimeoutError extends AppError {
  constructor(message = 'Timed out while waiting for an upstream worker slot.') {
    super(message, { statusCode: 503, code: 'queue_timeout' });
  }
}

export class QueueOverflowError extends AppError {
  constructor(message = 'The upstream queue is full.') {
    super(message, { statusCode: 503, code: 'queue_overflow' });
  }
}

export class RequestAbortedError extends AppError {
  constructor(message = 'The request was aborted by the client.') {
    super(message, { statusCode: 499, code: 'request_aborted' });
  }
}
