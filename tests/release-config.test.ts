import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const expectedPackageName = "@tiagojacinto/create-agent-stack";

describe("release configuration", () => {
  it("uses the available scoped npm package consistently", async () => {
    const packageJson = await readJson<{ name: string }>("package.json");
    const releaseConfig = await readJson<{
      packages: Record<string, { "package-name": string }>;
    }>("release-please-config.json");

    expect(packageJson.name).toBe(expectedPackageName);
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
