import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFeatureSelection, minimumSelection } from "../src/catalog.js";
import { generateProject } from "../src/generator.js";

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
    await expect(
      readFile(join(targetDirectory, ".github/workflows/ci.yml"), "utf8"),
    ).resolves.toContain("gitleaks/gitleaks-action");
    await expect(readFile(join(targetDirectory, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  it("refuses to overwrite a non-empty directory", async () => {
    const targetDirectory = await createTemporaryDirectory();
    await writeFile(join(targetDirectory, "human-work.txt"), "keep me", "utf8");

    await expect(generateProject({ targetDirectory, selection: minimumSelection })).rejects.toThrow(
      `Target directory is not empty:\n${targetDirectory}`,
    );
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "create-agent-stack-"));
  temporaryDirectories.push(directory);
  return directory;
}
