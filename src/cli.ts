#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { generateProject } from "./generator.js";
import type { Preset } from "./catalog.js";

interface CliOptions {
  readonly targetDirectory: string | undefined;
  readonly preset: string | undefined;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const terminal = createInterface({ input: stdin, output: stdout });

  try {
    const targetDirectory =
      options.targetDirectory ?? (await terminal.question("Project directory: ")).trim();
    const presetInput =
      options.preset ?? ((await terminal.question("Preset [minimum]: ")).trim() || "minimum");

    if (targetDirectory.length === 0) {
      throw new Error("Project directory is required.");
    }
    if (presetInput !== "minimum") {
      throw new Error(`Unknown preset "${presetInput}". Available preset: minimum.`);
    }

    const result = await generateProject({
      targetDirectory,
      preset: presetInput as Preset,
    });

    stdout.write(
      `Created ${result.directory} with the Minimum preset (${result.files.length} files).\n` +
        `Next: cd ${targetDirectory} && pnpm install && pnpm check\n`,
    );
  } finally {
    terminal.close();
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`create-agent-stack: ${message}\n`);
  process.exitCode = 1;
});
