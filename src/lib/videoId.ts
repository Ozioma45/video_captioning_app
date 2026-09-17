const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a videoId came from `crypto.randomUUID()` before it's used to
 * build a storage key — defense in depth against path traversal via a
 * route param, even though the storage layer independently re-validates
 * every resolved path (see LocalFilesystemStorage.getAbsolutePath).
 */
export function isValidVideoId(value: string): boolean {
  return UUID_PATTERN.test(value);
}
