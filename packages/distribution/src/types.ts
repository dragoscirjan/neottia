import type {
  HarnessAdapter,
  HarnessScope,
  HostConfigOperation,
  ReloadNotice,
  TargetPath,
} from '@neottia/harness-adapter';

/** JSON values accepted in host configuration entries. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** SHA-256 digest with an explicit algorithm prefix. */
export type Sha256 = `sha256:${string}`;

/** Ordered template sources, from defaults to local overrides. */
export type TemplateTier = 'packaged' | 'package' | 'global' | 'project';

/** One complete template file supplied at a precedence tier. */
export interface TemplateFile {
  readonly id: string;
  readonly content: string;
}

/** Explicit template source. Installed packages are never discovered by scanning. */
export interface TemplateLayer {
  readonly tier: TemplateTier;
  readonly sourceId: string;
  readonly version: string;
  readonly files: readonly TemplateFile[];
}

/** Explicit source manifest loaded without package discovery. */
export interface LoadTemplateLayerOptions {
  readonly tier: TemplateTier;
  readonly sourceId: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly maxBytes?: number;
}

/** Winning template plus the sources it replaced. */
export interface ResolvedTemplate {
  readonly id: string;
  readonly content: string;
  readonly checksum: Sha256;
  readonly sourceId: string;
  readonly version: string;
  readonly shadowed: readonly { readonly sourceId: string; readonly version: string; readonly checksum: Sha256 }[];
}

/** Immutable provenance attached to one manifest asset. */
export interface AssetSource {
  readonly kind:
    'packaged-template' | 'package-template' | 'global-override' | 'project-override' | 'external-skill' | 'generated';
  readonly id: string;
  readonly version: string;
  readonly checksum: Sha256;
  readonly packageName?: string;
}

/** Exact file bytes projected to a symbolic host path. */
export interface FileAsset {
  readonly kind: 'file';
  readonly id: string;
  readonly target: TargetPath;
  readonly encoding: 'utf8' | 'base64';
  readonly content: string;
  readonly checksum: Sha256;
  readonly source: AssetSource;
}

/** One semantic host configuration plan returned by an adapter. */
export interface HostConfigAsset {
  readonly kind: 'host-config';
  readonly id: string;
  readonly plan: {
    readonly hostId: string;
    readonly scope: HarnessScope;
    readonly target: { readonly candidates: readonly TargetPath[]; readonly createAt: TargetPath };
    readonly operations: readonly HostConfigOperation[];
  };
  readonly source: AssetSource;
}

/** Non-mutating check used by the doctor command. */
export interface Prerequisite {
  readonly id: string;
  readonly category: 'tool' | 'package' | 'mcp-server' | 'configuration';
  readonly description: string;
  readonly check:
    | { readonly kind: 'command'; readonly command: string }
    | { readonly kind: 'package'; readonly packageName: string }
    | { readonly kind: 'path'; readonly target: TargetPath }
    | { readonly kind: 'environment'; readonly variable: string };
  readonly instructions: string;
}

/** Canonical compiler-to-installer handoff consumed by future harnesses. */
export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly installationId: string;
  readonly owner: 'neottia';
  readonly producer: { readonly name: string; readonly version: string };
  readonly harnessId: string;
  readonly scope: HarnessScope;
  readonly configChecksum: Sha256;
  readonly templates: readonly ResolvedTemplate[];
  readonly prerequisites: readonly Prerequisite[];
  readonly assets: readonly (FileAsset | HostConfigAsset)[];
  readonly reloadNotice?: ReloadNotice;
  readonly checksum: Sha256;
}

/** Input used to construct and checksum a manifest. */
export type AssetManifestInput = Omit<AssetManifest, 'schemaVersion' | 'owner' | 'checksum'>;

/** Explicit absolute roots. Adapters never read these values. */
export interface InstallRoots {
  readonly project: string;
  readonly home: string;
  readonly xdgConfig: string;
  readonly xdgState: string;
}

/** Unit owned inside a path. Host configuration ownership is entry-level. */
export type OwnedUnit =
  | { readonly kind: 'file' }
  | { readonly kind: 'array-entry'; readonly pointer: string; readonly identity: string }
  | { readonly kind: 'object-entry'; readonly pointer: string; readonly key: string };

/** State restored when an approved operator unit is uninstalled. */
export type PreviousUnitState =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'displaced';
      readonly checksum: Sha256;
      readonly encoding: 'utf8' | 'base64' | 'json';
      readonly content: string;
    };

/** Receipt evidence for one file or host configuration entry. */
export interface ReceiptEntry {
  readonly assetId: string;
  readonly target: TargetPath;
  readonly unit: OwnedUnit;
  readonly owner: 'neottia';
  readonly source: AssetSource;
  readonly checksum: Sha256;
  readonly previous: PreviousUnitState;
}

/** Versioned ownership record used for safe update and uninstall. */
export interface InstallationReceipt {
  readonly schemaVersion: 1;
  readonly installationId: string;
  readonly manifestChecksum: Sha256;
  readonly harnessId: string;
  readonly scope: HarnessScope;
  readonly entries: readonly ReceiptEntry[];
  readonly checksum: Sha256;
}

/** Exact current state of one owned unit. */
export interface UnitState {
  readonly exists: boolean;
  readonly checksum?: Sha256;
  readonly encoding?: 'utf8' | 'base64' | 'json';
  readonly content?: string;
}

/** Full containing file state used only for optimistic concurrency and rollback. */
export interface ContainerState {
  readonly path: string;
  readonly exists: boolean;
  readonly checksum?: Sha256;
  readonly content?: string;
}

/** Desired unit and current receipt/filesystem evidence. */
export interface InspectedUnit {
  readonly assetId: string;
  readonly target: TargetPath;
  readonly path: string;
  readonly unit: OwnedUnit;
  readonly desired?: UnitState & { readonly exists: true };
  readonly current: UnitState;
  readonly container: ContainerState;
  readonly source?: AssetSource;
  readonly receipt?: ReceiptEntry;
}

/** Read-only machine state passed into the pure planner. */
export interface InstallationSnapshot {
  readonly roots: InstallRoots;
  readonly receiptPath: string;
  readonly receiptContainer: ContainerState;
  readonly receipt?: InstallationReceipt;
  readonly manifest?: AssetManifest;
  readonly units: readonly InspectedUnit[];
  readonly pendingTransaction: boolean;
}

/** Exact, individually approvable conflict. */
export interface InstallationConflict {
  readonly id: string;
  readonly assetId: string;
  readonly path: string;
  readonly reason: 'unowned-existing' | 'modified-owned';
  readonly approved: boolean;
}

/** Before-state guard for one containing file. */
export type ExpectedFile = { readonly exists: false } | { readonly exists: true; readonly checksum: Sha256 };

/** One complete containing-file mutation shown before application. */
export type PlanMutation =
  | {
      readonly id: string;
      readonly kind: 'write-file';
      readonly role: 'asset' | 'host-config' | 'receipt';
      readonly path: string;
      readonly root: string;
      readonly before: ExpectedFile;
      readonly encoding: 'utf8' | 'base64';
      readonly content: string;
      readonly checksum: Sha256;
    }
  | {
      readonly id: string;
      readonly kind: 'remove-file';
      readonly role: 'asset' | 'host-config' | 'receipt';
      readonly path: string;
      readonly root: string;
      readonly before: ExpectedFile & { readonly exists: true };
    };

/** Serializable plan reviewed and authorized before any mutation. */
export interface InstallationPlan {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly action: 'install' | 'update' | 'uninstall';
  readonly receiptPath: string;
  readonly receiptRoot: string;
  readonly mutations: readonly PlanMutation[];
  readonly conflicts: readonly InstallationConflict[];
  readonly reloadNotice?: ReloadNotice;
  readonly digest: Sha256;
}

/** Result of a committed filesystem transaction. */
export interface ApplyResult {
  readonly planId: string;
  readonly appliedMutations: readonly string[];
  readonly reloadNotice?: ReloadNotice;
}

/** Fault injection for deterministic rollback tests. */
export interface ApplyOptions {
  readonly beforeMutation?: (index: number, mutation: PlanMutation) => void | Promise<void>;
}

/** Persisted before-images used to recover an interrupted transaction. */
export interface TransactionJournal {
  readonly schemaVersion: 1;
  readonly planDigest: Sha256;
  readonly state: 'active' | 'committed';
  readonly entries: readonly {
    readonly path: string;
    readonly root: string;
    readonly before:
      | { readonly exists: false }
      | { readonly exists: true; readonly encoding: 'base64'; readonly content: string; readonly checksum: Sha256 };
    readonly after: ExpectedFile;
  }[];
}

/** One structured prerequisite result. */
export interface DoctorResult {
  readonly id: string;
  readonly category: Prerequisite['category'] | 'receipt';
  readonly status: 'ok' | 'error';
  readonly message: string;
  readonly instructions?: string;
}

/** Exact static skill source installed into an isolated staging directory. */
export interface ExternalSkillRequest {
  readonly id: string;
  readonly source: string;
  readonly revision: string;
  readonly integrity: Sha256;
  readonly skills: readonly string[];
  readonly scope: HarnessScope;
}

/** Limits for files accepted from the external skills package. */
export interface ExternalSkillLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

/** Inputs for isolated static-skill acquisition. */
export interface StageExternalSkillsOptions {
  readonly request: ExternalSkillRequest;
  readonly adapter: HarnessAdapter;
  readonly limits?: ExternalSkillLimits;
  readonly skillsBin?: string;
}
