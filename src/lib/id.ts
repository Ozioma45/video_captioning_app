/** Internal id generation — never derived from user-supplied filenames or content. */
export function generateId(): string {
  return crypto.randomUUID();
}
