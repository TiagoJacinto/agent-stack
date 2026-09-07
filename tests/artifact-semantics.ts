import { runInNewContext } from "node:vm";

import * as typescript from "typescript";

const ultraciteCore = { id: "ultracite-core", ignorePatterns: ["node_modules"] };
const ultraciteAntiSlop = { id: "ultracite-anti-slop" };
const eslintCore = { id: "eslint-core" };
const customEslint = { id: "custom-eslint" };

export const generatedConfigModules: Readonly<Record<string, unknown>> = {
  oxlint: { defineConfig: (config: unknown): unknown => config },
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

  for (const line of content.split("\n")) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    const indentation = line.length - line.trimStart().length;
    const value = line.trim();

    if (indentation === 0) {
      const key = yamlKey(value);
      section = key === "on" || key === "jobs" ? key : undefined;
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
        triggers[currentTrigger] = { branches: flowArray(entry.value) };
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
      readingSteps = value === "steps:";
      continue;
    }

    if (section === "jobs" && indentation === 6 && readingSteps && value.startsWith("- ")) {
      const entry = yamlEntry(value.slice(2));
      if (entry?.key === "run" || entry?.key === "uses") {
        currentJob.steps.push({ [entry.key]: entry.value });
      }
    }
  }

  return { triggers, jobs };
}

function yamlKey(value: string): string | undefined {
  return yamlEntry(value)?.key;
}

function yamlEntry(value: string): { readonly key: string; readonly value: string } | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0) return undefined;
  return { key: value.slice(0, separator), value: value.slice(separator + 1).trim() };
}

function flowArray(value: string): readonly string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  return value
    .slice(1, -1)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
