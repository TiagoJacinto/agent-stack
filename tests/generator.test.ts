import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

    const result = await generateProject({ targetDirectory, preset: "minimum" });

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

  it("refuses to overwrite a non-empty directory", async () => {
    const targetDirectory = await createTemporaryDirectory();
    await writeFile(join(targetDirectory, "human-work.txt"), "keep me", "utf8");

    await expect(generateProject({ targetDirectory, preset: "minimum" })).rejects.toThrow(
      `Target directory is not empty: ${targetDirectory}`,
    );
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "create-agent-stack-"));
  temporaryDirectories.push(directory);
  return directory;
}
