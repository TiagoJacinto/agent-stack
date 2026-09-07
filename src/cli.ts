#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { ensureTargetDirectoryIsEmpty, generateProject, mergeProject } from "./generator.js";
import {
  createFeatureSelection,
  featureCatalog,
  linterFeatures,
  lowSelection,
  minimumSelection,
  omitFeatures,
  selectionWarnings,
  type LinterFeatureId,
  type OptionalFeatureId,
} from "./catalog.js";

interface CliOptions {
  readonly command: "create" | "merge";
  readonly targetDirectory: string | undefined;
  readonly preset: string | undefined;
}

interface InputReader {
  readonly ask: (prompt: string) => Promise<string>;
  readonly close: () => void;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const input = await createInputReader(
    options.targetDirectory === undefined || options.preset === undefined,
  );

  try {
    const targetDirectory =
      options.targetDirectory ?? (await input.ask("Project directory: ")).trim();
    if (targetDirectory.length === 0) {
      throw new Error("Project directory is required.");
    }
    if (options.command === "create") {
      await ensureTargetDirectoryIsEmpty(targetDirectory);
    }

    const requestedSelection =
      options.preset === undefined
        ? await promptForFeatures(input)
        : presetSelection(options.preset);
    const selection = await confirmSelectionWarnings(input, requestedSelection);
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
        `Next: cd ${targetDirectory} && pnpm install && pnpm check\n`,
    );
  } finally {
    input.close();
  }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  const command = arguments_[0];
  if (command !== "create" && command !== "merge") {
    throw new Error('The first argument must be "create" or "merge".');
  }

  let targetDirectory: string | undefined;
  let preset: string | undefined;

  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--preset") {
      preset = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument?.startsWith("--preset=")) {
      preset = argument.slice("--preset=".length);
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

  return { command, targetDirectory, preset };
}

function presetSelection(value: string) {
  if (value === "minimum") return minimumSelection;
  if (value === "low") return lowSelection;
  throw new Error(`Unknown preset "${value}". Available presets: minimum, low.`);
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

async function promptForFeatures(input: InputReader) {
  stdout.write("Select optional features. Type y to include each feature.\n");
  const selected: OptionalFeatureId[] = [];
  for (const feature of featureCatalog.filter(({ parent }) => parent === null)) {
    await promptForFeature(input, feature, selected, 0);
  }
  if (selected.includes("ultracite") && !hasSelectedLinter(selected)) {
    selected.push(await promptForUltraciteBackend(input));
  }
  return createFeatureSelection(selected);
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

async function promptForFeature(
  input: InputReader,
  feature: FeatureDefinition,
  selected: OptionalFeatureId[],
  depth: number,
): Promise<void> {
  const response = (
    await input.ask(`${"  ".repeat(depth)}Include ${feature.label}? [y/N]: `)
  ).trim();
  if (!/^y(es)?$/i.test(response)) return;

  selected.push(feature.id);
  for (const child of featureCatalog.filter(({ parent }) => parent === feature.id)) {
    await promptForFeature(input, child, selected, depth + 1);
  }
}

async function confirmSelectionWarnings(
  input: InputReader,
  selection: ReturnType<typeof createFeatureSelection> | ReturnType<typeof presetSelection>,
) {
  const warnings = selectionWarnings(selection);
  if (warnings.length === 0) return selection;

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
  process.stderr.write(`create-agent-stack: ${message}\n`);
  process.exitCode = 1;
});
