import { ISSUE_TOOLS } from '@neottia/issues';
import { expect, it } from 'vitest';
import { buildIssueTools } from './index.js';

it('builds every OpenCode tool from the shared registry', () => {
  const factory = ((definition: unknown) => definition) as never;
  const tools = buildIssueTools({ cwd: '/tmp', interactive: false, configOverrides: { enabled: false } }, factory);
  expect(Object.keys(tools)).toEqual(ISSUE_TOOLS.map((tool) => tool.name));
});
