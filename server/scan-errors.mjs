// Error codes shared by the scan API, the worker and the browser.
// `status` is the HTTP status the API uses when a job fails before or during
// processing; the browser maps `code` to Indonesian copy.

export const ERROR_STATUS = Object.freeze({
  bad_metadata: 400,
  unsupported_media: 415,
  too_large: 413,
  not_found: 404,
  not_ready: 409,
  queue_full: 429,
  footage_invalid: 422,
  footage_short: 422,
  alignment_failed: 422,
  artifact_too_large: 422,
  disk_low: 507,
  tool_missing: 503,
  tool_timeout: 504,
  tool_failed: 500,
  server_stopped: 503,
  internal: 500,
});

export class ScanError extends Error {
  constructor(code, message, status = ERROR_STATUS[code] ?? 500) {
    super(message);
    this.name = "ScanError";
    this.code = code;
    this.status = status;
  }
}
