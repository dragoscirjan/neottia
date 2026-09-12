import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryStore, StoreMemoryInput } from './index.js';

/** Creates an isolated store for one backend-contract case. */
export type ImportContractStoreFactory = (caseId: string) => MemoryStore | Promise<MemoryStore>;

/**
 * Registers the import and lifecycle checks that every canonical backend must
 * pass. Each case compares the authority state before and after preview and
 * mutating rejection.
 */
export function registerImportLifecycleContract(name: string, createStore: ImportContractStoreFactory): void {
  describe(`${name} import lifecycle contract`, () => {
    const stores: MemoryStore[] = [];

    afterEach(async () => {
      while (stores.length > 0) await stores.pop()?.close();
    });

    async function open(caseId: string): Promise<MemoryStore> {
      const store = await createStore(caseId);
      stores.push(store);
      return store;
    }

    async function rejectWithoutMutation(store: MemoryStore, content: string, message: RegExp): Promise<void> {
      const before = await store.export();
      const preview = await store.import(content, true);
      expect(preview).toMatchObject({ valid: false, records: 0, tombstones: 0 });
      expect(preview.errors[0]).toMatch(message);
      expect(await store.export()).toBe(before);
      await expect(store.import(content)).rejects.toThrow(message);
      expect(await store.export()).toBe(before);
    }

    it('rejects foreign namespaces, secrets, and overflow identities', async () => {
      const namespaceStore = await open('namespace');
      const namespaceSeed = await namespaceStore.store(fact('Namespace seed'));
      const foreign = {
        ...namespaceSeed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        organization_id: `${namespaceSeed.organization_id}-foreign`,
      };
      await rejectWithoutMutation(namespaceStore, `${JSON.stringify(foreign)}\n`, /scope|namespace/u);

      const secretStore = await open('secret');
      const secretSeed = await secretStore.store(fact('Secret seed'));
      const secret = {
        ...secretSeed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        summary: 'token=ghp_012345678901234567890123456789',
      };
      await rejectWithoutMutation(secretStore, `${JSON.stringify(secret)}\n`, /secret/u);

      const identityStore = await open('identity');
      const identitySeed = await identityStore.store(fact('Identity seed'));
      const overflow = { ...identitySeed, id: '80000000000000000000000000' };
      await rejectWithoutMutation(identityStore, `${JSON.stringify(overflow)}\n`, /Invalid memory record/u);
    });

    it('rejects competing supersession and tombstone retirements', async () => {
      const duplicateStore = await open('duplicate-supersession');
      const duplicateTarget = await duplicateStore.store(fact('Duplicate retirement target'));
      const replacement = (id: string, summary: string) => ({
        ...duplicateTarget,
        id,
        summary,
        created_at: new Date(Date.parse(duplicateTarget.created_at) + 1).toISOString(),
        supersedes: [duplicateTarget.id],
      });
      const firstReplacement = replacement('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'First imported replacement');
      const secondReplacement = replacement('01ARZ3NDEKTSV4RRFFQ69G5FAW', 'Second imported replacement');
      await rejectWithoutMutation(
        duplicateStore,
        `${JSON.stringify(firstReplacement)}\n${JSON.stringify(secondReplacement)}\n`,
        /multiple supersession retirements/u,
      );

      const mixedStore = await open('mixed-retirement');
      const mixedTarget = await mixedStore.store(fact('Mixed retirement target'));
      const mixedReplacement = { ...firstReplacement, supersedes: [mixedTarget.id] };
      const tombstone = {
        schema_version: 1,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        organization_id: mixedTarget.organization_id,
        project_id: mixedTarget.project_id,
        target_id: mixedTarget.id,
        reason: 'Imported retirement',
        source: mixedTarget.source,
        created_at: new Date(Date.parse(mixedTarget.created_at) + 2).toISOString(),
        created_by: 'contract-test',
      };
      await rejectWithoutMutation(
        mixedStore,
        `${JSON.stringify(mixedReplacement)}\n${JSON.stringify(tombstone)}\n`,
        /both superseded and tombstoned/u,
      );

      const inactiveStore = await open('inactive-target');
      const inactiveTarget = await inactiveStore.store(fact('Already inactive target'));
      await inactiveStore.supersede(inactiveTarget.id, fact('Canonical replacement'));
      const lateReplacement = { ...secondReplacement, supersedes: [inactiveTarget.id] };
      await rejectWithoutMutation(
        inactiveStore,
        `${JSON.stringify(lateReplacement)}\n`,
        /already inactive in canonical state/u,
      );
    });

    it('rejects broken and cyclic supersession graphs', async () => {
      const brokenStore = await open('broken-reference');
      const brokenSeed = await brokenStore.store(fact('Broken reference seed'));
      const broken = {
        ...brokenSeed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        supersedes: ['01ARZ3NDEKTSV4RRFFQ69G5FAW'],
      };
      await rejectWithoutMutation(brokenStore, `${JSON.stringify(broken)}\n`, /Broken supersedes reference/u);

      const cycleStore = await open('cycle');
      const cycleSeed = await cycleStore.store(fact('Cycle seed'));
      const first = {
        ...cycleSeed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        summary: 'Cycle first',
        supersedes: ['01ARZ3NDEKTSV4RRFFQ69G5FAY'],
      };
      const second = {
        ...cycleSeed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        summary: 'Cycle second',
        supersedes: [first.id],
      };
      await rejectWithoutMutation(
        cycleStore,
        `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
        /Cyclic supersession/u,
      );
    });

    it('returns the same compactness failure for preview and mutation', async () => {
      const store = await open('compactness');
      const seed = await store.store(fact('Compactness seed'));
      const oversized = {
        ...seed,
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        summary: 'x'.repeat(241),
      };
      await rejectWithoutMutation(store, `${JSON.stringify(oversized)}\n`, /summary has 241 Unicode characters/u);
    });
  });
}

/** Builds a valid semantic fact for contract setup. */
function fact(summary: string): StoreMemoryInput {
  return {
    memory_type: 'semantic',
    record_type: 'fact',
    summary,
    source: { kind: 'user-confirmed', ref: null, revision: null },
    created_by: 'contract-test',
    confidence: 'confirmed',
  };
}
