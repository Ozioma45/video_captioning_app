/** The rendered file failed post-render validation (missing streams, wrong size/duration, ...). */
export class ExportOutputInvalidError extends Error {
  constructor(readonly problems: string[]) {
    super(`Exported file failed validation: ${problems.join("; ")}`);
    this.name = "ExportOutputInvalidError";
  }
}

/** The user cancelled the export. Not a failure. */
export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelledError";
  }
}

/** A bundled export font is missing from `assets/fonts` — a deployment problem, not a user problem. */
export class ExportFontMissingError extends Error {
  constructor(fileName: string) {
    super(`Export font not found: ${fileName}`);
    this.name = "ExportFontMissingError";
  }
}

/** The source video record has no usable frame size. */
export class ExportSourceInvalidError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ExportSourceInvalidError";
  }
}
