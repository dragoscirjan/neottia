import { describe, expect, it } from 'vitest';

import { SDLC_COMMAND_IDS, SDLC_PROTOCOL_SKILL_ID, SDLC_PROTOCOL_TEMPLATE_ID } from './lifecycle.js';
import { loadPackagedSdlcTemplateLayer } from './template-loader.js';

/** Loads the packaged operating protocol once for the whole suite. */
async function protocolBody(): Promise<string> {
  const layer = await loadPackagedSdlcTemplateLayer();
  const matches = layer.files.filter((file) => file.id === SDLC_PROTOCOL_TEMPLATE_ID);
  expect(matches).toHaveLength(1);
  return matches[0]!.content;
}

/** Capitalizes one lifecycle command id into its protocol heading. */
function commandHeading(command: string): string {
  return command.charAt(0).toUpperCase() + command.slice(1);
}

/** Splits one protocol body into its command sections by heading. */
function commandSections(body: string): Readonly<Record<string, string>> {
  const sections: Record<string, string> = {};
  for (const command of SDLC_COMMAND_IDS) {
    const heading = commandHeading(command);
    const start = body.indexOf(`\n## ${heading}\n`);
    if (start === -1) throw new Error(`Protocol is missing its ${command} section.`);
    const rest = body.slice(start + 1);
    const nextHeading = rest.slice(4).search(/\n## /u);
    sections[command] = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 4);
  }
  return sections;
}

describe('packaged SDLC operating protocol', () => {
  it('ships one provider-neutral protocol template for the shared skill', async () => {
    const body = await protocolBody();
    expect(body).toContain(`# Neottia SDLC operating protocol`);
    expect(body).toContain(SDLC_PROTOCOL_SKILL_ID);
    expect(body).toContain('They do not grant host permissions.');
    expect(body).not.toMatch(/\{\{|\{%|\{#/u);
    expect(body).not.toMatch(/\b(?:github|gitlab|bitbucket|jira|confluence|filesystem)\b/iu);
    expect(body).not.toMatch(/`(?:issue_|document_|git\b)/u);
    expect(body).not.toMatch(/[\r\0]/u);
  });

  it('defines the durable checkpoint format through append-only comments', async () => {
    const body = await protocolBody();
    expect(body).toContain('neottia-sdlc:checkpoint');
    for (const field of ['phase:', 'step:', 'status:', 'evidence:', 'next:']) {
      expect(body).toContain(field);
    }
    for (const status of ['completed', 'blocked', 'needs-approval']) {
      expect(body).toContain(status);
    }
    expect(body).toContain('append-only');
    expect(body).toContain('newest valid checkpoint defines the authoritative phase and step');
    expect(body).toContain('Malformed, incomplete, or out-of-order checkpoints are ignored');
  });

  it('gives every command authoritative inputs and stopping outcomes', async () => {
    const body = await protocolBody();
    const sections = commandSections(body);
    for (const command of SDLC_COMMAND_IDS) {
      expect(sections[command]).toContain('Authoritative inputs:');
      expect(sections[command]).toContain('Stopping outcomes:');
    }
  });

  it('keeps Plan on one owning Epic with explicit recorded approval', async () => {
    const plan = commandSections(await protocolBody()).plan!;
    expect(plan).toContain('Resolve exactly one owning Epic');
    expect(plan).toContain('present at most five');
    expect(plan).toContain('Record plan approval as an explicit Epic comment');
    expect(plan).toContain('not ready for Build');
    expect(plan).toContain('Stop without starting Build');
  });

  it('requires current approval and owned child work in Build', async () => {
    const build = commandSections(await protocolBody()).build!;
    expect(build).toContain('Require current plan approval');
    expect(build).toContain('return to Plan instead of proceeding');
    expect(build).toContain('ready child work owned by this Epic');
    expect(build).toContain('Verify boundary');
  });

  it('routes Verify defects to Build and scope changes to Plan', async () => {
    const verify = commandSections(await protocolBody()).verify!;
    expect(verify).toContain('exactly one canonical Bug parented to the Epic');
    expect(verify).toContain('route it back to Build');
    expect(verify).toContain('Defects never bypass Build');
    expect(verify).toContain('back to Plan as scope changes');
    expect(verify).toContain('pass verdict');
    expect(verify).toContain('Release requires this current verdict');
  });

  it('keeps Release consent action-specific and human-authorized', async () => {
    const release = commandSections(await protocolBody()).release!;
    expect(release).toContain('current successful verify verdict');
    expect(release).toContain('fresh, action-specific approval');
    expect(release).toContain('One approval never carries to the next action');
    expect(release).toContain('human-authorized by default');
    expect(release).toContain('Never merge, publish, deploy');
  });

  it('lets Continue resume exactly one step without inventing phase state', async () => {
    const body = await protocolBody();
    const resume = commandSections(body).resume ?? commandSections(body).continue!;
    expect(resume).toContain('at most five unfinished candidates');
    expect(resume).toContain('Without a valid checkpoint, no phase is inferred');
    expect(resume).toContain('exactly one same-phase step');
    expect(resume).toContain('stop without entering another phase');
    expect(resume).toContain('Recommend, never invoke, the next public command');
  });

  it('forbids lifecycle transitions in Refresh', async () => {
    const refresh = commandSections(await protocolBody()).refresh!;
    expect(refresh).toContain('no lifecycle transition');
    expect(refresh).toContain('Recommend Continue or a new Plan and stop');
  });

  it('protects revision semantics across every mutation', async () => {
    const body = await protocolBody();
    expect(body).toContain('a stale or missing revision is an error, never an overwrite');
  });
});
