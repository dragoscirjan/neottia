import { describe, expect, it } from 'vitest';

import { main, type CliOutput } from './index.js';

/** Captures CLI output without changing process streams. */
function capture(): { output: CliOutput; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    output: {
      log(message) {
        logs.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  };
}

describe('Neottia CLI', () => {
  it('documents the explicit plan and apply workflow', async () => {
    const result = capture();
    expect(await main(['help'], result.output)).toBe(0);
    expect(result.logs.join('\n')).toContain('neottia plan');
    expect(result.logs.join('\n')).toContain('neottia apply');
  });

  it('returns a failure for an unknown command', async () => {
    const result = capture();
    expect(await main(['unknown'], result.output)).toBe(1);
    expect(result.errors).toEqual(['Unknown command: unknown']);
  });
});
