import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type { FeatureSelection } from "./catalog.js";
import { projectFiles } from "./project-template.js";

export interface GenerateProjectOptions {
  readonly targetDirectory: string;
  readonly selection: FeatureSelection;
}

export interface GeneratedProject {
  readonly directory: string;
  readonly files: readonly string[];
}

export async function generateProject(options: GenerateProjectOptions): Promise<GeneratedProject> {
  const directory = resolve(options.targetDirectory);
  await assertTargetIsEmpty(directory);

  const projectName = normalizePackageName(basename(directory));
  const files = projectFiles(projectName, options.selection);

  for (const [relativePath, content] of Object.entries(files)) {
    const destination = resolve(directory, relativePath);
    if (!destination.startsWith(`${directory}/`)) {
      throw new Error(`Template path escapes the project directory: ${relativePath}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }

  return { directory, files: Object.keys(files).sort() };
}

async function assertTargetIsEmpty(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${directory}`);
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
