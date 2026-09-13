import { expect, it } from 'vitest';
import { truncateUtf8 } from './utf8.js';

it('preserves a leading byte-order mark on bounded and truncated paths', () => {
  const value = '\uFEFFabcdef';
  expect(truncateUtf8(value, Buffer.byteLength(value))).toBe(value);
  expect(truncateUtf8(value, 5)).toBe('\uFEFFab');
});
