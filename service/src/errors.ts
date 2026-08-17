export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;

  constructor(status: number, code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function badRequest(code: string, detail?: string): ApiError {
  return new ApiError(400, code, detail);
}

export function unauthorized(detail?: string): ApiError {
  return new ApiError(401, "unauthorized", detail);
}

export function notFound(code = "not_found", detail?: string): ApiError {
  return new ApiError(404, code, detail);
}

export function conflict(code: string, detail?: string): ApiError {
  return new ApiError(409, code, detail);
}

export function llmUnavailable(detail?: string): ApiError {
  return new ApiError(503, "llm_unavailable", detail);
}
