export class UnknownStyleError extends Error {
  constructor(styleId: string) {
    super(`No caption style preset with id "${styleId}"`);
    this.name = "UnknownStyleError";
  }
}

export class InvalidStyleError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid caption style: ${issues.join("; ")}`);
    this.name = "InvalidStyleError";
  }
}
