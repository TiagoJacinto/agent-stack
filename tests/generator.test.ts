import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFeatureSelection, lowSelection, minimumSelection } from "../src/catalog.js";
import { generateProject, mergeProject } from "../src/generator.js";
import {
  evaluateGeneratedModule,
  parseWorkflow,
} from "./artifact-semantics.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generateProject", () => {
  it("generates the Minimum preset and records the selection", async () => {
    const workspace = await createTemporaryDirectory();
    const targetDirectory = join(workspace, "Example Project");

    const result = await generateProject({ targetDirectory, selection: minimumSelection });

    expect(result.files).toContain(".agent-stack/manifest.json");
    const manifest = JSON.parse(
      await readFile(join(targetDirectory, ".agent-stack/manifest.json"), "utf8"),
    ) as { preset: string; features: string[] };
    const packageJson = JSON.parse(
      await readFile(join(targetDirectory, "package.json"), "utf8"),
    ) as { name: string; scripts: Record<string, string> };

    expect(manifest.preset).toBe("minimum");
    expect(manifest.features).toContain("vitest");
    expect(packageJson.name).toBe("example-project");
    expect(Object.keys(packageJson.scripts)).toEqual(
      expect.arrayContaining(["dev", "build", "test", "check"]),
    );
  });

  it("generates the Low preset with mutation testing", async () => {
    const workspace = await createTemporaryDirectory();
    const targetDirectory = join(workspace, "Low Project");

    const result = await generateProject({ targetDirectory, selection: lowSelection });

    const manifest = JSON.parse(
      await readFile(join(targetDirectory, ".agent-stack/manifest.json"), "utf8"),
    ) as { preset: string; features: string[] };
    const packageJson = JSON.parse(
      await readFile(join(targetDirectory, "package.json"), "utf8"),
    ) as { devDependencies: Record<string, string>; scripts: Record<string, string> };

    expect(manifest.preset).toBe("low");
    expect(manifest.features).toEqual(
      expect.arrayContaining([
        "vitest",
        "property-testing",
        "mutation-testing",
        "gitleaks",
        "dependency-audit",
      ]),
    );
    expect(packageJson.devDependencies).toHaveProperty("@fast-check/vitest");
    expect(packageJson.devDependencies).toHaveProperty("fast-check");
    expect(packageJson.devDependencies).toHaveProperty("@stryker-mutator/core");
    expect(packageJson.devDependencies).toHaveProperty("@stryker-mutator/vitest-runner");
    expect(packageJson.scripts.mutation).toBe("stryker run");
    expect(result.files).toContain("stryker.config.mjs");
    const stryker = evaluateGeneratedModule<{
      testRunner: string;
      plugins: string[];
    }>(await readFile(join(targetDirectory, "stryker.config.mjs"), "utf8"));
    expect(stryker.testRunner).toBe("vitest");
    expect(stryker.plugins).toContain("@stryker-mutator/vitest-runner");
  });

  it("resolves dependencies and omits unselected optional features", async () => {
    const workspace = await createTemporaryDirectory();
    const targetDirectory = join(workspace, "Custom Project");

    await generateProject({
      targetDirectory,
      selection: createFeatureSelection(["oxfmt", "vitest", "gitleaks"]),
    });

    const manifest = JSON.parse(
      await readFile(join(targetDirectory, ".agent-stack/manifest.json"), "utf8"),
    ) as { selection: { mode: string; requested: string[]; resolved: string[] } };
    const packageJson = JSON.parse(
      await readFile(join(targetDirectory, "package.json"), "utf8"),
    ) as { devDependencies: Record<string, string> };

    expect(manifest.selection).toEqual({
      mode: "features",
      requested: ["oxfmt", "vitest", "gitleaks"],
      resolved: [
        "typescript-node-pnpm",
        "obvious-scripts",
        "oxfmt",
        "vitest",
        "github-actions",
        "gitleaks",
      ],
    });
    expect(packageJson.devDependencies).not.toHaveProperty("oxlint");
    const workflow = parseWorkflow(
      await readFile(join(targetDirectory, ".github/workflows/ci.yml"), "utf8"),
    );
    expect(workflow.jobs.verify?.steps).toContainEqual({ uses: "gitleaks/gitleaks-action@v2" });
    await expect(readFile(join(targetDirectory, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  it("refuses to overwrite a non-empty directory", async () => {
    const targetDirectory = await createTemporaryDirectory();
    await writeFile(join(targetDirectory, "human-work.txt"), "keep me", "utf8");

    await expect(generateProject({ targetDirectory, selection: minimumSelection })).rejects.toThrow(
      `Target directory is not empty:\n${targetDirectory}`,
    );
  });

  it("merges generated capabilities without replacing existing project content", async () => {
    const targetDirectory = await createTemporaryDirectory();
    const existingPackage = {
      name: "existing-package",
      version: "9.8.7",
      description: "Human-authored metadata",
      scripts: { existing: "echo existing" },
      dependencies: { picocolors: "^1.1.1" },
    };
    await writeFile(
      join(targetDirectory, "package.json"),
      `${JSON.stringify(existingPackage, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(targetDirectory, "README.md"), "# Existing project\n", "utf8");
    await writeFile(join(targetDirectory, "src.ts"), "export const existing = true;\n", "utf8");

    const result = await mergeProject({ targetDirectory, selection: minimumSelection });

    const packageJson = JSON.parse(
      await readFile(join(targetDirectory, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      description: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson).toMatchObject(existingPackage);
    expect(packageJson.scripts.existing).toBe("echo existing");
    expect(packageJson.scripts.test).toBe("vitest run --passWithNoTests");
    expect(packageJson.devDependencies).toHaveProperty("vitest");
    await expect(readFile(join(targetDirectory, "README.md"), "utf8")).resolves.toEqual(
      expect.stringContaining("# Existing project"),
    );
    await expect(readFile(join(targetDirectory, "README.md"), "utf8")).resolves.toContain(
      "<!-- agent-stack:start -->",
    );
    await expect(readFile(join(targetDirectory, "src.ts"), "utf8")).resolves.toBe(
      "export const existing = true;\n",
    );
    await expect(readFile(join(targetDirectory, "src/index.ts"), "utf8")).rejects.toThrow();
    await expect(readFile(join(targetDirectory, "tests/index.test.ts"), "utf8")).rejects.toThrow();
    expect(result.files).toContain("package.json");
  });

  it("merges structured configuration and is idempotent", async () => {
    const targetDirectory = await createTemporaryDirectory();
    await writeFile(
      join(targetDirectory, "package.json"),
      `${JSON.stringify({ name: "existing", scripts: { custom: "echo custom" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(targetDirectory, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            paths: { "@/*": ["src/*"] },
          },
          include: ["custom/**/*.ts"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      join(targetDirectory, "oxlint.config.ts"),
      'import { defineConfig } from "oxlint";\n\nexport default defineConfig({\n  rules: { "no-alert": "warn" },\n});\n',
      "utf8",
    );
    await mkdir(join(targetDirectory, ".github/workflows"), { recursive: true });
    await writeFile(
      join(targetDirectory, ".github/workflows/ci.yml"),
      "name: Existing CI\n\non:\n  push:\n    branches: [develop]\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n",
      "utf8",
    );

    const first = await mergeProject({ targetDirectory, selection: minimumSelection });
    const tsconfig = JSON.parse(await readFile(join(targetDirectory, "tsconfig.json"), "utf8")) as {
      compilerOptions: { paths: Record<string, string[]> };
      include: string[];
    };
    const oxlint = evaluateGeneratedModule<{
      extends: { id: string }[];
      rules: Record<string, string>;
    }>(await readFile(join(targetDirectory, "oxlint.config.ts"), "utf8"));
    const workflow = parseWorkflow(
      await readFile(join(targetDirectory, ".github/workflows/ci.yml"), "utf8"),
    );

    expect(first.files).toContain("tsconfig.json");
    expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["src/*"]);
    expect(tsconfig.include).toEqual(["src/**/*.ts", "tests/**/*.ts", "custom/**/*.ts"]);
    expect(oxlint.rules).toEqual({ "no-alert": "warn" });
    expect(oxlint.extends.map(({ id }) => id)).toEqual([
      "ultracite-core",
      "ultracite-anti-slop",
    ]);
    expect(workflow.triggers).toEqual(
      expect.objectContaining({ pull_request: {}, push: { branches: ["develop", "main"] } }),
    );
    expect(workflow.jobs).toEqual(
      expect.objectContaining({
        build: { steps: [{ run: "echo build" }] },
        verify: expect.objectContaining({
          steps: expect.arrayContaining([{ uses: "actions/checkout@v4" }]),
        }),
      }),
    );

    const second = await mergeProject({ targetDirectory, selection: minimumSelection });
    expect(second.files).toEqual([]);
  });

  it("merges both linter configurations without duplicate entries", async () => {
    const targetDirectory = await createTemporaryDirectory();
    await writeFile(
      join(targetDirectory, "oxlint.config.ts"),
      'import { defineConfig } from "oxlint";\n\nexport default defineConfig({\n  rules: { "no-alert": "warn" },\n});\n',
      "utf8",
    );
    await writeFile(
      join(targetDirectory, "eslint.config.mjs"),
      'import custom from "custom";\n\nexport default [custom];\n',
      "utf8",
    );

    await mergeProject({
      targetDirectory,
      selection: createFeatureSelection(["oxlint", "eslint", "ultracite"]),
    });

    const oxlint = evaluateGeneratedModule<{ extends: { id: string }[] }>(
      await readFile(join(targetDirectory, "oxlint.config.ts"), "utf8"),
    );
    const eslint = evaluateGeneratedModule<{ id: string }[]>(
      await readFile(join(targetDirectory, "eslint.config.mjs"), "utf8"),
    );
    expect(oxlint.extends.map(({ id }) => id)).toEqual(["ultracite-core"]);
    expect(eslint.map(({ id }) => id)).toEqual(["custom-eslint", "eslint-core"]);
  });

  it("reports every conflicting managed path before writing files", async () => {
    const targetDirectory = await createTemporaryDirectory();
    await writeFile(
      join(targetDirectory, "package.json"),
      `${JSON.stringify({ name: "existing", version: "1.0.0" }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(targetDirectory, "oxlint.config.ts"), "export default [];\n", "utf8");
    await writeFile(join(targetDirectory, "human-work.txt"), "keep me\n", "utf8");

    await expect(mergeProject({ targetDirectory, selection: minimumSelection })).rejects.toThrow(
      "oxlint.config.ts",
    );
    await expect(readFile(join(targetDirectory, "human-work.txt"), "utf8")).resolves.toBe(
      "keep me\n",
    );
    await expect(readFile(join(targetDirectory, "tsconfig.json"), "utf8")).rejects.toThrow();
  });

  it("refuses to merge through a symlinked managed file", async () => {
    const targetDirectory = await createTemporaryDirectory();
    const outsideDirectory = await createTemporaryDirectory();
    const outsideManifest = join(outsideDirectory, "manifest.json");
    await writeFile(outsideManifest, '{"owned":"outside"}\n', "utf8");
    await mkdir(join(targetDirectory, ".agent-stack"), { recursive: true });
    await symlink(outsideManifest, join(targetDirectory, ".agent-stack/manifest.json"));

    await expect(mergeProject({ targetDirectory, selection: minimumSelection })).rejects.toThrow(
      "Template path uses a symlink",
    );
    await expect(readFile(outsideManifest, "utf8")).resolves.toBe('{"owned":"outside"}\n');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "create-agent-stack-"));
  temporaryDirectories.push(directory);
  return directory;
}
