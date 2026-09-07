import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import type { FeatureSelection } from "./catalog.js";
import { prepareNewFile, reconcileFile } from "./merge.js";
import { projectFiles } from "./project-template.js";

export interface GenerateProjectOptions {
  readonly targetDirectory: string;
  readonly selection: FeatureSelection;
}

export interface GeneratedProject {
  readonly directory: string;
  readonly files: readonly string[];
}

export class MergeConflictError extends Error {
  constructor(readonly conflicts: readonly string[]) {
    super(`Merge conflicts:\n${conflicts.join("\n")}`);
    this.name = "MergeConflictError";
  }
}

export async function ensureTargetDirectoryIsEmpty(targetDirectory: string): Promise<void> {
  await assertTargetIsEmpty(resolve(targetDirectory));
}

export async function generateProject(options: GenerateProjectOptions): Promise<GeneratedProject> {
  const directory = resolve(options.targetDirectory);
  await ensureTargetDirectoryIsEmpty(directory);

  const projectName = normalizePackageName(basename(directory));
  const files = projectFiles(projectName, options.selection);
  await writeFiles(directory, files);

  return { directory, files: Object.keys(files).sort() };
}

export async function mergeProject(options: GenerateProjectOptions): Promise<GeneratedProject> {
  const directory = resolve(options.targetDirectory);
  await ensureTargetDirectoryExists(directory);

  const projectName = normalizePackageName(basename(directory));
  const generatedFiles = projectFiles(projectName, options.selection);
  const files = Object.fromEntries(
    Object.entries(generatedFiles).filter(
      ([relativePath]) => !mergeOnlyExclusions.has(relativePath),
    ),
  );
  const changes = await planMerge(directory, files);

  if (changes.conflicts.length > 0) {
    throw new MergeConflictError(changes.conflicts);
  }

  await writeFiles(directory, changes.files);
  return { directory, files: Object.keys(changes.files).sort() };
}

const mergeOnlyExclusions = new Set(["src/index.ts", "tests/index.test.ts"]);

async function writeFiles(
  directory: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = resolve(directory, relativePath);
    await assertSafeDestination(directory, relativePath, destination);
    await mkdir(dirname(destination), { recursive: true });
    await assertSafeDestination(directory, relativePath, destination);
    await writeFile(destination, content, "utf8");
  }
}

async function planMerge(
  directory: string,
  files: Readonly<Record<string, string>>,
): Promise<{ readonly files: Record<string, string>; readonly conflicts: readonly string[] }> {
  const planned: Record<string, string> = {};
  const conflicts: string[] = [];

  for (const [relativePath, generatedContent] of Object.entries(files)) {
    const destination = resolve(directory, relativePath);
    await assertSafeDestination(directory, relativePath, destination);
    const existingContent = await readExistingFile(destination);

    if (existingContent === undefined) {
      planned[relativePath] = prepareNewFile(relativePath, generatedContent);
      continue;
    }
    const reconciliation = reconcileFile(relativePath, existingContent, generatedContent);
    conflicts.push(...reconciliation.conflicts);
    if (
      reconciliation.changed &&
      reconciliation.conflicts.length === 0 &&
      reconciliation.content !== existingContent
    ) {
      planned[relativePath] = reconciliation.content;
    }
  }

  return { files: planned, conflicts };
}

async function readExistingFile(destination: string): Promise<string | undefined> {
  try {
    return await readFile(destination, "utf8");
  } catch (error) {
    if (isMissingDirectory(error)) return undefined;
    return "";
  }
}

async function assertSafeDestination(
  directory: string,
  relativePath: string,
  destination: string,
): Promise<void> {
  if (!destination.startsWith(`${directory}/`)) {
    throw new Error(`Template path escapes the project directory: ${relativePath}`);
  }

  const root = await lstat(directory);
  if (root.isSymbolicLink()) {
    throw new Error(`Template path uses a symlinked project directory: ${directory}`);
  }

  let current = directory;
  for (const segment of relative(directory, destination).split(sep)) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new Error(`Template path uses a symlink: ${relativePath}`);
      }
    } catch (error) {
      if (isMissingDirectory(error)) break;
      throw error;
    }
  }
}

async function ensureTargetDirectoryExists(directory: string): Promise<void> {
  try {
    const target = await stat(directory);
    if (!target.isDirectory()) {
      throw new Error(`Target is not a directory:\n${directory}`);
    }
  } catch (error) {
    if (isMissingDirectory(error)) {
      throw new Error(`Target directory does not exist:\n${directory}`);
    }
    throw error;
  }
}

async function assertTargetIsEmpty(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty:\n${directory}`);
    }
  } catch (error) {
    if (isMissingDirectory(error)) {
      await mkdir(directory, { recursive: true });
      return;
    }
    throw error;
  }
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function normalizePackageName(directoryName: string): string {
  const normalized = directoryName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    throw new Error(`Cannot derive a package name from directory: ${directoryName}`);
  }

  return normalized;
}
