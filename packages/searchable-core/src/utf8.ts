/** Truncates without splitting a UTF-8 code point or repeatedly encoding the full string. */
export function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maximumBytes) return value;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let length = maximumBytes; length >= Math.max(0, maximumBytes - 3); length -= 1)
    try {
      return decoder.decode(bytes.subarray(0, length));
    } catch {
      // A UTF-8 code point uses at most four bytes, so at most three tails are incomplete.
    }
  return '';
}
