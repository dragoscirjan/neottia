import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

declare const Bun: {
  TOML: {
    parse(text: string): unknown;
  };
};

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ArgumentDefinition =
  | {
      type: "boolean";
      required?: boolean;
      default?: boolean;
    }
  | {
      type: "string";
      required?: boolean;
      default?: string;
      choices?: readonly string[];
    };

export type ArgumentDefinitions = Record<string, ArgumentDefinition>;

type ParsedArgument<Definition extends ArgumentDefinition> = Definition extends {
  type: "boolean";
}
  ? boolean
  : Definition extends { choices: readonly (infer Choice extends string)[] }
    ? Choice
    : Definition extends { required: true } | { default: string }
      ? string
      : string | undefined;

export type ParsedArguments<Definitions extends ArgumentDefinitions> = {
  -readonly [Name in keyof Definitions]: ParsedArgument<Definitions[Name]>;
};

export interface TomlTaskDefinition {
  description?: string;
  depends?: readonly string[];
  run?: string;
}

export interface WorkspaceOperation {
  action: "create" | "unchanged" | "update";
  path: string;
  detail?: string;
}

export interface PlannedFile {
  action: "create" | "update";
  path: string;
  content: string;
  redacted: boolean;
  mode?: string;
}

export interface CommandPlan {
  command: string;
  args?: readonly string[];
}

export interface InitializerResult {
  skill: string;
  mode: string;
  root: string;
  operations: readonly WorkspaceOperation[];
  files?: readonly PlannedFile[];
  pending?: readonly (CommandPlan | string)[];
  [key: string]: unknown;
}

interface StagedFile {
  content: string;
  mode?: number;
}

interface StageOptions {
  createOnly?: boolean;
  mode?: number;
}

interface SetExactOptions {
  preserveExisting?: boolean;
}

export const EXIT = Object.freeze({
  OK: 0,
  USAGE: 2,
  CONFLICT: 3,
  ENVIRONMENT: 4,
  COMMAND: 5,
  IO: 6,
});

export class InitError extends Error {
  readonly code: number;
  readonly details: JsonObject | undefined;

  constructor(message: string, code: number = EXIT.IO, details?: JsonObject) {
    super(message);
    this.name = "InitError";
    this.code = code;
    this.details = details;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function requireBun(): void {
  if (typeof Bun === "undefined" || typeof Bun.TOML?.parse !== "function") {
    throw new InitError(
      "Bun with Bun.TOML.parse is required to run this initializer; install Bun and invoke the script with bun",
      EXIT.ENVIRONMENT,
    );
  }
}

function parseTomlValue(rawValue: string, location: string): unknown {
  requireBun();
  try {
    const parsed = Bun.TOML.parse(`value = ${rawValue}`) as Record<string, unknown>;
    return parsed.value;
  } catch (error) {
    throw new InitError(`Invalid TOML value at ${location}: ${errorMessage(error)}`, EXIT.CONFLICT);
  }
}

function validateToml(text: string): void {
  requireBun();
  try {
    Bun.TOML.parse(text);
  } catch (error) {
    throw new InitError(`Invalid TOML document: ${errorMessage(error)}`, EXIT.CONFLICT);
  }
}

function finalizeToml(text: string, location: string): string {
  requireBun();
  try {
    Bun.TOML.parse(text);
  } catch (error) {
    throw new InitError(
      `Conflict while updating ${location}: generated TOML is invalid: ${errorMessage(error)}`,
      EXIT.CONFLICT,
    );
  }
  return text;
}

export function parseArgs<const Definitions extends ArgumentDefinitions>(
  argv: readonly string[],
  definitions: Definitions,
): ParsedArguments<Definitions> {
  const values: Record<string, boolean | string | undefined> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    if (Object.hasOwn(definition, "default")) values[name] = definition.default;
    else if (definition.type === "boolean") values[name] = false;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) break;
    if (!token.startsWith("--")) {
      throw new InitError(`Unexpected positional argument: ${token}`, EXIT.USAGE);
    }
    const name = token.slice(2);
    const definition = definitions[name];
    if (!definition) throw new InitError(`Unknown option: ${token}`, EXIT.USAGE);
    if (definition.type === "boolean") {
      values[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new InitError(`Option ${token} requires a value`, EXIT.USAGE);
    }
    index += 1;
    if (definition.choices && !definition.choices.includes(value)) {
      throw new InitError(
        `Option ${token} must be one of: ${definition.choices.join(", ")}`,
        EXIT.USAGE,
      );
    }
    values[name] = value;
  }

  if (!values.help) {
    for (const [name, definition] of Object.entries(definitions)) {
      if (definition.required && !values[name]) {
        throw new InitError(`Missing required option: --${name}`, EXIT.USAGE);
      }
    }
    if (values.apply && values["dry-run"]) {
      throw new InitError("Use either --dry-run or --apply, not both", EXIT.USAGE);
    }
    if (values.apply && !values.confirm) {
      throw new InitError("--apply requires --confirm after the plan is approved", EXIT.USAGE);
    }
    if (values.install && !values.apply) {
      throw new InitError("--install requires --apply --confirm", EXIT.USAGE);
    }
    if (values.confirm && !values.apply) {
      throw new InitError("--confirm is valid only with --apply", EXIT.USAGE);
    }
  }

  return values as ParsedArguments<Definitions>;
}

export function validateVersion(value: string, option: string): string {
  if (!/^[0-9][0-9A-Za-z.+-]*$/.test(value)) {
    throw new InitError(`${option} must be a pinned version or major without spaces`, EXIT.USAGE);
  }
  return value;
}

export function validateRelativePath(value: string, option: string): string {
  if (
    !value ||
    isAbsolute(value) ||
    value.split(/[\\/]/).includes("..") ||
    !/^[A-Za-z0-9._/\\-]+$/.test(value)
  ) {
    throw new InitError(`${option} must be a safe project-relative path`, EXIT.USAGE);
  }
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
}

export function resolveRoot(input: string): string {
  const root = resolve(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new InitError(`Project root is not a directory: ${root}`, EXIT.ENVIRONMENT);
  }
  return realpathSync(root);
}

function assertContained(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
  throw new InitError(`Path escapes the project root: ${target}`, EXIT.USAGE);
}

function nearestExistingParent(target: string): string {
  let current = target;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function redactPlannedValue(
  value: unknown,
  key = "",
): { value: unknown; redacted: boolean } {
  if (/(?:token|secret|password|credential|private.?key|auth)/i.test(key)) {
    return { value: "<redacted>", redacted: true };
  }
  if (Array.isArray(value)) {
    let redacted = false;
    const result = value.map((item) => {
      const nested = redactPlannedValue(item);
      redacted ||= nested.redacted;
      return nested.value;
    });
    return { value: result, redacted };
  }
  if (value && typeof value === "object") {
    let redacted = false;
    const result: Record<string, unknown> = {};
    for (const [entry, item] of Object.entries(value)) {
      const nested = redactPlannedValue(item, entry);
      redacted ||= nested.redacted;
      result[entry] = nested.value;
    }
    return { value: result, redacted };
  }
  return { value, redacted: false };
}

function redactPlannedContent(
  relativePath: string,
  content: string,
): { content: string; redacted: boolean } {
  let normalized = content;
  let structuredRedaction = false;
  if (relativePath.endsWith(".json")) {
    try {
      const parsed = redactPlannedValue(JSON.parse(content));
      normalized = formatJson(parsed.value);
      structuredRedaction = parsed.redacted;
    } catch {
      // The owning JSON parser reports malformed input before this plan is emitted.
    }
  }
  const redacted =
    structuredRedaction ||
    /(https?:\/\/)[^/@\s]+@/i.test(normalized) ||
    /^(\s*[A-Za-z0-9_.-]*(?:token|secret|password|credential|private.?key|auth)[A-Za-z0-9_.-]*\s*=\s*).+$/im.test(normalized) ||
    /([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*=)[^\s]+/.test(normalized);
  const sanitized = normalized
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1<redacted>@")
    .replace(
      /^(\s*[A-Za-z0-9_.-]*(?:token|secret|password|credential|private.?key|auth)[A-Za-z0-9_.-]*\s*=\s*).+$/gim,
      "$1<redacted>",
    )
    .replace(
      /([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)[A-Z0-9_]*=)[^\s]+/g,
      "$1<redacted>",
    );
  return { content: sanitized, redacted };
}

export class Workspace {
  readonly root: string;
  readonly staged = new Map<string, StagedFile>();
  readonly operations: WorkspaceOperation[] = [];

  constructor(root: string) {
    this.root = resolveRoot(root);
  }

  path(relativePath: string): string {
    if (!relativePath || isAbsolute(relativePath)) {
      throw new InitError(`Expected a project-relative path: ${relativePath}`, EXIT.USAGE);
    }
    const target = resolve(this.root, relativePath);
    assertContained(this.root, target);
    const parent = nearestExistingParent(dirname(target));
    const parentReal = realpathSync(parent);
    assertContained(this.root, parentReal);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
      throw new InitError(`Refusing to modify symlink: ${relativePath}`, EXIT.CONFLICT);
    }
    return target;
  }

  read(relativePath: string): string | null {
    const staged = this.staged.get(relativePath);
    if (staged) return staged.content;
    const target = this.path(relativePath);
    return existsSync(target) ? readFileSync(target, "utf8") : null;
  }

  stage(relativePath: string, content: string, options: StageOptions = {}): void {
    const previous = this.read(relativePath);
    if (options.createOnly && previous !== null && previous !== content) {
      throw new InitError(
        `Existing ${relativePath} differs from the initializer template`,
        EXIT.CONFLICT,
      );
    }
    if (previous === content) {
      const target = this.path(relativePath);
      const modeMatches =
        options.mode === undefined ||
        (existsSync(target) && (statSync(target).mode & 0o777) === options.mode);
      if (modeMatches) {
        this.operations.push({ action: "unchanged", path: relativePath });
        return;
      }
    }
    this.staged.set(relativePath, {
      content,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    });
    this.operations.push({ action: previous === null ? "create" : "update", path: relativePath });
  }

  appendLine(relativePath: string, line: string): void {
    const current = this.read(relativePath) ?? "";
    if (current.split(/\r?\n/).includes(line)) {
      this.operations.push({ action: "unchanged", path: relativePath, detail: line });
      return;
    }
    const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    this.stage(relativePath, `${current}${separator}${line}\n`);
  }

  plannedFiles(): PlannedFile[] {
    return [...this.staged.entries()].map(([relativePath, staged]) => {
      const planned = redactPlannedContent(relativePath, staged.content);
      return {
        action: existsSync(this.path(relativePath)) ? "update" : "create",
        path: relativePath,
        content: planned.content,
        redacted: planned.redacted,
        ...(staged.mode === undefined
          ? {}
          : { mode: `0${staged.mode.toString(8)}` }),
      };
    });
  }

  apply(): void {
    for (const [relativePath, staged] of this.staged) {
      const target = this.path(relativePath);
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.init-${process.pid}-${Date.now()}`;
      try {
        writeFileSync(temporary, staged.content, "utf8");
        if (staged.mode !== undefined) chmodSync(temporary, staged.mode);
        renameSync(temporary, target);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
  }
}

export function readJsonObject(
  workspace: Workspace,
  relativePath: string,
  fallback: JsonObject = {},
): JsonObject {
  const text = workspace.read(relativePath);
  if (text === null) return structuredClone(fallback);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new InitError(
      `Invalid JSON in ${relativePath}: ${errorMessage(error)}`,
      EXIT.CONFLICT,
    );
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new InitError(`${relativePath} must contain a JSON object`, EXIT.CONFLICT);
  }
  return value as JsonObject;
}

function formatJsonValue(value: unknown, level = 0): string {
  const indent = "  ".repeat(level);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    if (value.every((item) => item === null || typeof item !== "object") && indent.length + inline.length <= 80) {
      return inline;
    }
    if (value.length === 0) return "[]";
    return `[\n${value
      .map((item) => `${"  ".repeat(level + 1)}${formatJsonValue(item, level + 1)}`)
      .join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([key, item]) => `${"  ".repeat(level + 1)}${JSON.stringify(key)}: ${formatJsonValue(item, level + 1)}`)
    .join(",\n")}\n${indent}}`;
}

export function formatJson(value: unknown): string {
  return `${formatJsonValue(value)}\n`;
}

export function writeJsonObject(
  workspace: Workspace,
  relativePath: string,
  value: JsonObject,
): void {
  workspace.stage(relativePath, formatJson(value));
}

export function setExact(
  object: Record<string, JsonValue>,
  key: string,
  value: JsonValue,
  location: string,
  options: SetExactOptions = {},
): void {
  if (!Object.hasOwn(object, key)) {
    object[key] = value;
    return;
  }
  if (options.preserveExisting) return;
  if (JSON.stringify(object[key]) !== JSON.stringify(value)) {
    throw new InitError(
      `Conflict at ${location}.${key}: existing value differs from the approved initializer value`,
      EXIT.CONFLICT,
    );
  }
}

export function mergeExactMap(
  object: Record<string, JsonValue>,
  key: string,
  expected: Readonly<Record<string, JsonValue>>,
  location: string,
): void {
  if (!Object.hasOwn(object, key)) object[key] = {};
  if (!object[key] || Array.isArray(object[key]) || typeof object[key] !== "object") {
    throw new InitError(`${location}.${key} must be an object`, EXIT.CONFLICT);
  }
  const target = object[key] as JsonObject;
  for (const [entry, value] of Object.entries(expected)) {
    setExact(target, entry, value, `${location}.${key}`);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function taskHeaderPattern(name: string): RegExp {
  const escaped = escapeRegex(name);
  return new RegExp(`^\\[tasks\\.(?:"${escaped}"|${escaped})\\]\\s*$`);
}

function sectionBounds(
  lines: readonly string[],
  matcher: RegExp,
): { start: number; end: number } | null {
  const start = lines.findIndex((line) => matcher.test(line.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && /^\[[^\]]+\]\s*$/.test(line.trim())) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function ensureSimpleKey(
  lines: string[],
  bounds: { start: number; end: number },
  key: string,
  rawValue: string,
  location: string,
): string[] {
  const pattern = new RegExp(`^${escapeRegex(key)}\\s*=\\s*(.+?)\\s*$`);
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const match = line.trim().match(pattern);
    const matchedValue = match?.[1];
    if (matchedValue === undefined) continue;
    const existing = parseTomlValue(matchedValue, `${location}.${key}`);
    const expected = parseTomlValue(rawValue, `${location}.${key}`);
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new InitError(`Conflict at ${location}.${key}`, EXIT.CONFLICT);
    }
    return lines;
  }
  lines.splice(bounds.end, 0, `${key} = ${rawValue}`);
  return lines;
}

export function ensureTomlTableKey(
  text: string,
  table: string,
  key: string,
  rawValue: string,
): string {
  validateToml(text);
  const lines = text.replace(/\s+$/, "").split("\n");
  let bounds = sectionBounds(lines, new RegExp(`^\\[${escapeRegex(table)}\\]\\s*$`));
  if (!bounds) {
    if (lines.length && lines[0] !== "") lines.push("");
    lines.push(`[${table}]`, `${key} = ${rawValue}`);
  } else {
    ensureSimpleKey(lines, bounds, key, rawValue, table);
  }
  return finalizeToml(`${lines.join("\n").replace(/^\n+/, "")}\n`, `${table}.${key}`);
}

function formatTomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function ownTableValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function ensureTomlTask(
  text: string,
  name: string,
  definition: TomlTaskDefinition,
): string {
  validateToml(text);
  const lines = text.replace(/\s+$/, "").split("\n");
  let bounds = sectionBounds(lines, taskHeaderPattern(name));
  if (!bounds) {
    if (lines.length && lines[0] !== "") lines.push("");
    lines.push(`[tasks.${JSON.stringify(name)}]`);
    if (definition.description) lines.push(`description = ${JSON.stringify(definition.description)}`);
    if (definition.depends) lines.push(`depends = ${formatTomlStringArray(definition.depends)}`);
    if (definition.run) lines.push(`run = ${JSON.stringify(definition.run)}`);
    return finalizeToml(
      `${lines.join("\n").replace(/^\n+/, "")}\n`,
      `tasks.${name}`,
    );
  }

  if (definition.depends?.length && !definition.run) {
    const task = ownTableValue(ownTableValue(Bun.TOML.parse(text), "tasks"), name);
    const run = ownTableValue(task, "run");
    const commands = Array.isArray(run) ? run : [run];
    // Recognize only unconditional literal failing placeholders; never erase commands.
    const placeholder = /^(?:echo|printf)\s+(['"])[^'"]*\bnot (?:yet )?configured\b[^'"]*\1\s*(?:>&2\s*)?(?:;|&&)\s*exit\s+1\s*;?$/i;
    if (commands.some((command) => typeof command === "string" && placeholder.test(command.trim()))) {
      throw new InitError(
        `Unconfigured aggregate task ${name}; reconcile its placeholder through an approved plan before adding checks`,
        EXIT.CONFLICT,
      );
    }
  }
  if (definition.run) {
    ensureSimpleKey(lines, bounds, "run", JSON.stringify(definition.run), `tasks.${name}`);
    bounds = sectionBounds(lines, taskHeaderPattern(name)) ?? bounds;
  }
  if (definition.depends) {
    const dependsIndex = lines.findIndex(
      (line, index) =>
        index > bounds.start && index < bounds.end && /^depends\s*=/.test(line.trim()),
    );
    if (dependsIndex < 0) {
      lines.splice(bounds.end, 0, `depends = ${formatTomlStringArray(definition.depends)}`);
    } else {
      const match = lines[dependsIndex]?.trim().match(/^depends\s*=\s*(\[[^\n]*\])\s*$/);
      const matchedValue = match?.[1];
      if (matchedValue === undefined) {
        throw new InitError(
          `Cannot safely merge multiline dependencies in task ${name}; reconcile it manually`,
          EXIT.CONFLICT,
        );
      }
      const existing = parseTomlValue(matchedValue, `tasks.${name}.depends`);
      if (!Array.isArray(existing) || existing.some((item) => typeof item !== "string")) {
        throw new InitError(`Task ${name} has unsupported dependency syntax`, EXIT.CONFLICT);
      }
      const dependencies = existing as string[];
      for (const dependency of definition.depends) {
        if (!dependencies.includes(dependency)) dependencies.push(dependency);
      }
      lines[dependsIndex] = `depends = ${formatTomlStringArray(dependencies)}`;
    }
  }
  return finalizeToml(
    `${lines.join("\n").replace(/^\n+/, "")}\n`,
    `tasks.${name}`,
  );
}

export function ensureTomlArrayItem(
  text: string,
  table: string,
  key: string,
  item: string,
): string {
  validateToml(text);
  const lines = text.replace(/\s+$/, "").split("\n");
  let bounds = sectionBounds(lines, new RegExp(`^\\[${escapeRegex(table)}\\]\\s*$`));
  if (!bounds) {
    if (lines.length && lines[0] !== "") lines.push("");
    lines.push(`[${table}]`, `${key} = ${formatTomlStringArray([item])}`);
    return finalizeToml(
      `${lines.join("\n").replace(/^\n+/, "")}\n`,
      `${table}.${key}`,
    );
  }
  const keyIndex = lines.findIndex(
    (line, index) => index > bounds.start && index < bounds.end && new RegExp(`^${escapeRegex(key)}\\s*=`).test(line.trim()),
  );
  if (keyIndex < 0) {
    lines.splice(bounds.end, 0, `${key} = ${formatTomlStringArray([item])}`);
    return finalizeToml(
      `${lines.join("\n").replace(/^\n+/, "")}\n`,
      `${table}.${key}`,
    );
  }
  const match = lines[keyIndex]?.trim().match(new RegExp(`^${escapeRegex(key)}\\s*=\\s*(\\[[^\\n]*\\])\\s*$`));
  const matchedValue = match?.[1];
  if (matchedValue === undefined) {
    throw new InitError(
      `Cannot safely merge multiline ${table}.${key}; reconcile it manually`,
      EXIT.CONFLICT,
    );
  }
  const values = parseTomlValue(matchedValue, `${table}.${key}`);
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new InitError(`${table}.${key} must be an array of strings`, EXIT.CONFLICT);
  }
  const stringValues = values as string[];
  if (!stringValues.includes(item)) stringValues.push(item);
  lines[keyIndex] = `${key} = ${formatTomlStringArray(stringValues)}`;
  return finalizeToml(
    `${lines.join("\n").replace(/^\n+/, "")}\n`,
    `${table}.${key}`,
  );
}

function redactDiagnostics(value: string): string {
  return value
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1<redacted>@")
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*=)[^\s]+/gi, "$1<redacted>");
}

export function runCommand(root: string, command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = redactDiagnostics(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
  if (output) process.stderr.write(`${output.slice(0, 8000)}${output.length > 8000 ? "\n…truncated" : ""}\n`);
  if (result.error || result.status !== 0) {
    throw new InitError(
      `Command failed: ${command} ${args.join(" ")}`,
      EXIT.COMMAND,
      {
        status: result.status,
        ...(result.error ? { error: result.error.message } : {}),
      },
    );
  }
}

export function requireGitRoot(root: string): void {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new InitError("The project root must be an initialized Git repository", EXIT.ENVIRONMENT);
  }
  const gitRoot = realpathSync(result.stdout.trim());
  if (gitRoot !== root) {
    throw new InitError(`--root must be the Git root: ${gitRoot}`, EXIT.ENVIRONMENT);
  }
}

export function projectName(root: string): string {
  return basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

export function emit(result: InitializerResult, format = "json"): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.mode.toUpperCase()} ${result.skill} at ${result.root}\n`);
  for (const operation of result.operations) {
    process.stdout.write(`- ${operation.action}: ${operation.path}${operation.detail ? ` (${operation.detail})` : ""}\n`);
  }
  if (result.files?.length) {
    process.stdout.write("Planned file contents:\n");
    for (const file of result.files) {
      process.stdout.write(`--- ${file.path}${file.redacted ? " (sensitive values redacted)" : ""}\n`);
      process.stdout.write(file.content.endsWith("\n") ? file.content : `${file.content}\n`);
    }
  }
  if (result.pending?.length) {
    process.stdout.write("Pending commands:\n");
    for (const command of result.pending) {
      const display = typeof command === "string"
        ? command
        : [command.command, ...(command.args ?? [])].join(" ");
      process.stdout.write(`- ${display}\n`);
    }
  }
}

export function handleError(error: unknown, help?: string): void {
  const normalized = error instanceof InitError
    ? error
    : new InitError(errorMessage(error), EXIT.IO);
  process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
  if (normalized.details) process.stderr.write(`${JSON.stringify(normalized.details)}\n`);
  if (normalized.code === EXIT.USAGE && help) process.stderr.write(`\n${help}\n`);
  process.exitCode = normalized.code;
}
