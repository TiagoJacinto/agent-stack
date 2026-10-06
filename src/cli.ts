#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";

import { ensureTargetDirectoryIsEmpty, generateProject, mergeProject } from "./generator.js";
import {
  createFeatureSelection,
  featureCatalog,
  linterFeatures,
  packageManagers,
  type PackageManager,
  presetSelection,
  presets,
  omitFeatures,
  selectionWarnings,
  type LinterFeatureId,
  type OptionalFeatureId,
} from "./catalog.js";

interface CliOptions {
  readonly command: "create" | "merge";
  readonly targetDirectory: string | undefined;
  readonly name: string | undefined;
  readonly preset: string | undefined;
  readonly features: string | undefined;
  readonly packageManager: string | undefined;
  readonly nonInteractive: boolean;
}

interface InputReader {
  readonly ask: (prompt: string) => Promise<string>;
  readonly close: () => void;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const preselectedFeatures =
    options.features === undefined ? [] : parseFeatureList(options.features);
  const needsInput =
    !options.nonInteractive &&
    (options.command === "create"
      ? options.name === undefined || options.preset === undefined
      : options.targetDirectory === undefined || options.preset === undefined);
  const input = await createInputReader(needsInput);

  try {
    const projectName =
      options.command === "create"
        ? (options.name ?? (await input.ask("Project name: ")).trim())
        : undefined;
    if (projectName !== undefined) validateProjectName(projectName);
    const targetDirectory =
      options.command === "create"
        ? resolve(projectName ?? "")
        : (options.targetDirectory ??
          (options.nonInteractive ? undefined : (await input.ask("Project directory: ")).trim()));
    if (targetDirectory === undefined || targetDirectory.length === 0) {
      throw new Error("Project directory is required.");
    }
    let selection: ReturnType<typeof createFeatureSelection> | ReturnType<typeof selectPreset>;
    if (options.nonInteractive) {
      const requestedSelection = selectNonInteractive(options, preselectedFeatures);
      selection = await confirmSelectionWarnings(input, requestedSelection, true);
      if (options.command === "create") {
        await ensureTargetDirectoryIsEmpty(targetDirectory);
      }
    } else {
      if (options.command === "create") {
        await ensureTargetDirectoryIsEmpty(targetDirectory);
      }
      const requestedSelection =
        options.preset === undefined
          ? await promptForFeatures(input, options.packageManager, preselectedFeatures)
          : selectPreset(options.preset, options.packageManager);
      selection = await confirmSelectionWarnings(input, requestedSelection, false);
    }
    const result =
      options.command === "create"
        ? await generateProject({ targetDirectory, selection })
        : await mergeProject({ targetDirectory, selection });
    const origin =
      selection.mode === "preset"
        ? `the ${capitalize(selection.preset)} preset`
        : "selected features";

    stdout.write(
      `${options.command === "create" ? "Created" : "Merged"} ${result.directory} with ${origin} (${result.files.length} files).\n` +
        `Next: cd ${targetDirectory} && ${selection.packageManager} install && ${selection.packageManager} check\n`,
    );
  } finally {
    input.close();
  }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  const firstArgument = arguments_[0];
  const hasExplicitCommand = firstArgument === "create" || firstArgument === "merge";
  const command: CliOptions["command"] = hasExplicitCommand ? firstArgument : "create";
  let targetDirectory: string | undefined;
  let name: string | undefined;
  let preset: string | undefined;
  let features: string | undefined;
  let packageManager: string | undefined;
  let nonInteractive = false;

  for (let index = hasExplicitCommand ? 1 : 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--no-interactive") {
      nonInteractive = true;
      continue;
    }
    const option = argument?.match(/^--(name|preset|features|package-manager)(?:=(.*))?$/);
    if (option !== null && option !== undefined) {
      const optionName = option[1];
      const inlineValue = option[2];
      const value = inlineValue ?? arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Option --${optionName} requires a value.`);
      }
      if (inlineValue === undefined) index += 1;
      if (optionName === "name") name = value;
      if (optionName === "preset") preset = value;
      if (optionName === "features") features = value;
      if (optionName === "package-manager") packageManager = value;
      continue;
    }
    if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (targetDirectory !== undefined) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    targetDirectory = argument;
  }

  if (command === "create") {
    if (targetDirectory !== undefined) {
      throw new Error(
        `Unexpected destination "${targetDirectory}"; use --name instead of a destination.`,
      );
    }
    if (name === undefined && nonInteractive) {
      throw new Error("--name is required when creating a project non-interactively.");
    }
    if (name !== undefined) validateProjectName(name);
  } else if (name !== undefined) {
    throw new Error("--name can only be used when creating a project.");
  }
  if (preset !== undefined && features !== undefined) {
    throw new Error("--preset and --features cannot be combined.");
  }
  return { command, targetDirectory, name, preset, features, packageManager, nonInteractive };
}

function validateProjectName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid project name "${name}". Use lowercase letters, numbers, and hyphens.`);
  }
}

function selectPreset(value: string, packageManagerValue?: string) {
  if (!(presets as readonly string[]).includes(value)) {
    throw new Error(`Unknown preset "${value}". Available presets: ${presets.join(", ")}.`);
  }
  return presetSelection(
    value as (typeof presets)[number],
    selectPackageManager(packageManagerValue),
  );
}

function selectNonInteractive(
  options: CliOptions,
  requestedFeatures: readonly OptionalFeatureId[],
) {
  if (options.preset !== undefined && options.features !== undefined) {
    throw new Error("A preset and individual features cannot be combined.");
  }

  const packageManager = selectPackageManager(options.packageManager);
  if (options.preset !== undefined) return selectPreset(options.preset, packageManager);

  if (options.features === undefined) {
    throw new Error("A preset or explicit feature selection is required in non-interactive mode.");
  }
  const requested = [...requestedFeatures];
  const selection = createFeatureSelection(requested, packageManager);
  if (requested.includes("ultracite") && !hasSelectedLinter(requested)) {
    const withDefaultBackend = createFeatureSelection([...requested, "oxlint"], packageManager);
    return { ...withDefaultBackend, requested: selection.requested };
  }
  return selection;
}

function selectPackageManager(value?: string): PackageManager {
  if (value === undefined) return packageManagers[0];
  if ((packageManagers as readonly string[]).includes(value)) {
    return value as PackageManager;
  }
  throw new Error(`Unknown package manager "${value}". Available: ${packageManagers.join(", ")}.`);
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

async function promptForFeatures(
  input: InputReader,
  packageManagerValue?: string,
  preselectedFeatures: readonly OptionalFeatureId[] = [],
) {
  const packageManager =
    packageManagerValue === undefined
      ? await promptForPackageManager(input)
      : selectPackageManager(packageManagerValue);
  stdout.write("Select optional features. Type y to include each feature.\n");
  const requested = [...new Set(preselectedFeatures)];
  const selected = createFeatureSelection(requested, packageManager).features.filter(
    (feature): feature is OptionalFeatureId => featureCatalog.some(({ id }) => id === feature),
  );
  for (const feature of featureCatalog.filter(({ parent }) => parent === null)) {
    await promptForFeature(feature, { input, selected, requested, depth: 0 });
  }
  if (selected.includes("ultracite") && !hasSelectedLinter(selected)) {
    const backend = await promptForUltraciteBackend(input);
    selected.push(backend);
    requested.push(backend);
  }
  return createFeatureSelection(requested, packageManager);
}

function parseFeatureList(value: string): OptionalFeatureId[] {
  const names = value.split(",").map((feature) => feature.trim());
  if (names.some((feature) => feature.length === 0)) {
    throw new Error("Feature selection must be a comma-separated list or `none`.");
  }
  if (names.length === 1 && names[0] === "none") return [];
  if (names.includes("none")) {
    throw new Error('"none" must be used by itself as the feature selection.');
  }
  for (const name of names) {
    if (!featureCatalog.some(({ id }) => id === name)) {
      throw new Error(`Unknown feature "${name}".`);
    }
  }
  return [...new Set(names)] as OptionalFeatureId[];
}

async function promptForPackageManager(input: InputReader): Promise<PackageManager> {
  stdout.write("Choose a package manager:\n  (*) pnpm\n  ( ) Bun\n");
  const response = (await input.ask("Package manager [1]: ")).trim().toLowerCase();
  if (response.length === 0 || response === "1" || response === "pnpm") return packageManagers[0];
  if (response === "2" || response === "bun") return packageManagers[1];
  throw new Error(
    `Unknown package manager "${response}". Available: ${packageManagers.join(", ")}.`,
  );
}

function hasSelectedLinter(selected: readonly OptionalFeatureId[]): boolean {
  return linterFeatures.some((linter) => selected.includes(linter));
}

async function promptForUltraciteBackend(input: InputReader): Promise<LinterFeatureId> {
  stdout.write("Choose Ultracite's backend:\n  1. Oxlint (default)\n  2. ESLint\n");
  const response = (await input.ask("Backend [1]: ")).trim().toLowerCase();
  if (response.length === 0 || response === "1" || response === "oxlint") return "oxlint";
  if (response === "2" || response === "eslint") return "eslint";
  throw new Error(`Unknown Ultracite backend "${response}". Available backends: oxlint, eslint.`);
}

type FeatureDefinition = (typeof featureCatalog)[number];

interface FeaturePromptState {
  readonly input: InputReader;
  readonly selected: OptionalFeatureId[];
  readonly requested: OptionalFeatureId[];
  readonly depth: number;
}

async function promptForFeature(
  feature: FeatureDefinition,
  state: FeaturePromptState,
): Promise<void> {
  if (state.selected.includes(feature.id)) {
    for (const child of featureCatalog.filter(({ parent }) => parent === feature.id)) {
      await promptForFeature(child, { ...state, depth: state.depth + 1 });
    }
    return;
  }

  const response = (
    await state.input.ask(`${"  ".repeat(state.depth)}Include ${feature.label}? [y/N]: `)
  ).trim();
  if (!/^y(es)?$/i.test(response)) return;

  state.selected.push(feature.id);
  state.requested.push(feature.id);
  for (const child of featureCatalog.filter(({ parent }) => parent === feature.id)) {
    await promptForFeature(child, { ...state, depth: state.depth + 1 });
  }
}

async function confirmSelectionWarnings(
  input: InputReader,
  selection: ReturnType<typeof createFeatureSelection> | ReturnType<typeof selectPreset>,
  nonInteractive: boolean,
) {
  const warnings = selectionWarnings(selection);
  if (warnings.length === 0) return selection;
  if (nonInteractive) {
    throw new Error(
      `Unsupported feature combination: ${warnings.map(({ message }) => message).join(" ")}`,
    );
  }

  for (const warning of warnings) stdout.write(`Warning: ${warning.message}\n`);
  const response = (await input.ask("Continue without unsupported features? [y/N]: ")).trim();
  if (!/^y(es)?$/i.test(response)) {
    throw new Error("Generation cancelled.");
  }

  return omitFeatures(
    selection,
    warnings.flatMap(({ omitted }) => omitted),
  );
}

async function createInputReader(needsInput: boolean): Promise<InputReader> {
  if (!needsInput) {
    return {
      ask: async () => "",
      close: () => undefined,
    };
  }

  if (stdin.isTTY) {
    const terminal = createInterface({ input: stdin, output: stdout });
    return {
      ask: (prompt) => terminal.question(prompt),
      close: () => terminal.close(),
    };
  }

  const lines = (await readPipedInput()).split(/\r?\n/);
  let index = 0;
  return {
    ask: async (prompt) => {
      stdout.write(prompt);
      return lines[index++] ?? "";
    },
    close: () => undefined,
  };
}

function readPipedInput(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string | Buffer) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    });
    stdin.on("end", () => resolve(chunks.join("")));
    stdin.on("error", reject);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`create-better-agent-stack: ${message}\n`);
  process.exitCode = 1;
});
