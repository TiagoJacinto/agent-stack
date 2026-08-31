#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { generateProject } from "./generator.js";
import {
  createFeatureSelection,
  featureCatalog,
  minimumSelection,
  type OptionalFeatureId,
} from "./catalog.js";

interface CliOptions {
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

    const selection =
      options.preset === undefined
        ? await promptForFeatures(input)
        : presetSelection(options.preset);
    const result = await generateProject({ targetDirectory, selection });
    const origin = selection.mode === "preset" ? "the Minimum preset" : "selected features";

    stdout.write(
      `Created ${result.directory} with ${origin} (${result.files.length} files).\n` +
        `Next: cd ${targetDirectory} && pnpm install && pnpm check\n`,
    );
  } finally {
    input.close();
  }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  let targetDirectory: string | undefined;
  let preset: string | undefined;

  for (let index = 0; index < arguments_.length; index += 1) {
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

  return { targetDirectory, preset };
}

function presetSelection(value: string) {
  if (value !== "minimum") {
    throw new Error(`Unknown preset "${value}". Available preset: minimum.`);
  }
  return minimumSelection;
}

async function promptForFeatures(input: InputReader) {
  stdout.write("Select optional features. Type y to include each feature.\n");
  const selected: OptionalFeatureId[] = [];
  for (const feature of featureCatalog) {
    const response = (await input.ask(`Include ${feature.label}? [y/N]: `)).trim();
    if (/^y(es)?$/i.test(response)) selected.push(feature.id);
  }
  return createFeatureSelection(selected);
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
