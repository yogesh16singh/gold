export class SetupError extends Error {
  constructor(message) {
    super(message);
    this.name = "SetupError";
  }
}

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class TransientError extends Error {
  constructor(message) {
    super(message);
    this.name = "TransientError";
  }
}

export class BrandSkip extends Error {
  constructor(message) {
    super(message);
    this.name = "BrandSkip";
  }
}
