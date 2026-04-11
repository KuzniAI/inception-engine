export type ErrorCode =
  | "INVALID_ARGS"
  | "MANIFEST_INVALID"
  | "DEPLOY_FAILED"
  | "RESOLVE_FAILED";

export class UserError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UserError";
    this.code = code;
  }
}
