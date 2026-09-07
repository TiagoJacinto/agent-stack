import { runInNewContext } from "node:vm";

import * as typescript from "typescript";

const ultraciteCore = { id: "ultracite-core", ignorePatterns: ["node_modules"] };
const ultraciteAntiSlop = { id: "ultracite-anti-slop" };
const eslintCore = { id: "eslint-core" };
const customEslint = { id: "custom-eslint" };

export const generatedConfigModules: Readonly<Record<string, unknown>> = {
  oxlint: { defineConfig: (config: unknown): unknown => config },
  "vitest/config": { defineConfig: (config: unknown): unknown => config },
  "ultracite/oxlint/core": { default: ultraciteCore },
  "ultracite/oxlint/anti-slop": { default: ultraciteAntiSlop },
  "ultracite/eslint/core": { default: eslintCore },
  custom: { default: customEslint },
};

export function evaluateGeneratedModule<T>(
  content: string,
  modules: Readonly<Record<string, unknown>> = generatedConfigModules,
): T {
  const output = typescript.transpileModule(content, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText;
  const exportsObject: Record<string, unknown> = {};
  const moduleObject = { exports: exportsObject };
  const requireModule = (specifier: string): unknown => {
    const module = modules[specifier];
    if (module === undefined) throw new Error(`No test module for ${specifier}`);
    return module;
  };

  runInNewContext(output, {
    exports: exportsObject,
    module: moduleObject,
    require: requireModule,
  });

  return (moduleObject.exports.default ?? moduleObject.exports) as T;
}

export type WorkflowStep = Readonly<Partial<Record<"run" | "uses", string>>>;

export interface WorkflowModel {
  readonly triggers: Record<string, { readonly branches?: readonly string[] }>;
  readonly jobs: Record<string, { readonly steps: readonly WorkflowStep[] }>;
}

export function parseWorkflow(content: string): WorkflowModel {
  const triggers: Record<string, { branches?: readonly string[] }> = {};
  const jobs: Record<string, { steps: WorkflowStep[] }> = {};
  let section: "on" | "jobs" | undefined;
  let currentTrigger: string | undefined;
  let currentJob: { steps: WorkflowStep[] } | undefined;
  let readingSteps = false;

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    const indentation = line.length - line.trimStart().length;
    const value = line.trim();

    if (indentation === 0) {
      const entry = yamlEntry(value);
      section =
        entry !== undefined &&
        entry.value.length === 0 &&
        (entry.key === "on" || entry.key === "jobs")
          ? entry.key
          : undefined;
      currentTrigger = undefined;
      currentJob = undefined;
      readingSteps = false;
      continue;
    }

    if (section === "on" && indentation === 2) {
      const entry = yamlEntry(value);
      if (entry === undefined) continue;
      currentTrigger = entry.key;
      triggers[currentTrigger] = {};
      continue;
    }

    if (section === "on" && indentation === 4 && currentTrigger !== undefined) {
      const entry = yamlEntry(value);
      if (entry?.key === "branches") {
        if (entry.value.length > 0) {
          triggers[currentTrigger] = { branches: flowArray(entry.value) };
        } else {
          const branches: string[] = [];
          let branchIndex = index + 1;
          for (; branchIndex < lines.length; branchIndex += 1) {
            const branch = /^\s+-\s*(.+)$/.exec(lines[branchIndex] ?? "");
            if (branch === null || (branch[0]?.search(/\S/) ?? 0) <= indentation) break;
            branches.push(branch[1] ?? "");
          }
          triggers[currentTrigger] = { branches };
          index = branchIndex - 1;
        }
      }
      continue;
    }

    if (section === "jobs" && indentation === 2) {
      const entry = yamlEntry(value);
      if (entry === undefined) continue;
      currentJob = { steps: [] };
      jobs[entry.key] = currentJob;
      readingSteps = false;
      continue;
    }

    if (section === "jobs" && indentation === 4 && currentJob !== undefined) {
      readingSteps = yamlEntry(value)?.key === "steps";
      continue;
    }

    if (section === "jobs" && indentation === 6 && readingSteps && value.startsWith("- ")) {
      const stepValue = value.slice(2).trim();
      const entry = yamlEntry(
        stepValue.startsWith("{") && stepValue.endsWith("}")
          ? stepValue.slice(1, -1).trim()
          : stepValue,
      );
      if ((entry?.key === "run" || entry?.key === "uses") && currentJob !== undefined) {
        currentJob.steps.push({ [entry.key]: entry.value.replace(/\s*,\s*$/, "") });
      }
    }
  }

  return { triggers, jobs };
}

function yamlEntry(value: string): { readonly key: string; readonly value: string } | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0) return undefined;
  const rawKey = value.slice(0, separator).trim();
  const key =
    rawKey.length >= 2 &&
    ((rawKey.startsWith('"') && rawKey.endsWith('"')) ||
      (rawKey.startsWith("'") && rawKey.endsWith("'")))
      ? rawKey.slice(1, -1)
      : rawKey;
  return { key, value: value.slice(separator + 1).trim() };
}

function flowArray(value: string): readonly string[] {
  const withoutComment = yamlValueWithoutComment(value);
  if (!withoutComment.startsWith("[") || !withoutComment.endsWith("]")) return [];
  return withoutComment
    .slice(1, -1)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function yamlValueWithoutComment(value: string): string {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return value.slice(0, index).trimEnd();
  }
  return value.trim();
}
