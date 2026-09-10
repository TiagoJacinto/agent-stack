import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const expectedPackageName = "create-better-agent-stack";
const expectedRepositoryUrl = "https://github.com/TiagoJacinto/agent-stack";

describe("release configuration", () => {
  it("uses the Bun create npm package consistently", async () => {
    const packageJson = await readJson<{
      name: string;
      repository: { type: string; url: string };
      bin: { "create-better-agent-stack": string };
      publishConfig: { access: string };
    }>("package.json");
    const releaseConfig = await readJson<{
      packages: Record<string, { "package-name": string }>;
    }>("release-please-config.json");

    expect(packageJson.name).toBe(expectedPackageName);
    expect(packageJson.repository).toEqual({ type: "git", url: expectedRepositoryUrl });
    expect(packageJson.bin).toEqual({ "create-better-agent-stack": "dist/cli.js" });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(releaseConfig.packages["."]?.["package-name"]).toBe(expectedPackageName);
  });
});

async function readJson<T>(path: string): Promise<T> {
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source) as T;
  } catch (error) {
    throw new Error(`Release configuration is not valid JSON: ${path}`, { cause: error });
  }
}
