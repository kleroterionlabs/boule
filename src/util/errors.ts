// src/util/errors.ts — named errors drive CLI exit codes and stage failure policy.
export class BouleError extends Error {
  override name = "BouleError";
}
export class ConfigError extends BouleError {
  override name = "ConfigError";
}
export class RateLimitError extends BouleError {
  override name = "RateLimitError";
}
export class BudgetExceededError extends BouleError {
  override name = "BudgetExceededError";
}
export class ValidationGateError extends BouleError {
  override name = "ValidationGateError";
  constructor(
    message: string,
    readonly failedCharacteristics: string[] = [],
  ) {
    super(message);
  }
}
