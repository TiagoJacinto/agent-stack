import type { FeatureId, FeatureSelection } from "./catalog.js";

export function projectFiles(
  projectName: string,
  selection: FeatureSelection,
): Readonly<Record<string, string>> {
  const files: Record<string, string> = {
    "package.json": packageJson(projectName, selection),
    "tsconfig.json": tsconfig(selection),
    "tsconfig.build.json": json({
      extends: "./tsconfig.json",
      compilerOptions: {
        outDir: "dist",
        rootDir: "src",
        declaration: true,
        sourceMap: true,
        types: ["node"],
      },
      include: ["src/**/*.ts"],
    }),
    "src/index.ts": sourceEntryPoint(),
    ".gitignore": text`
      node_modules/
      dist/
      coverage/
      reports/
      .stryker-tmp/
      .DS_Store
    `,
    "README.md": projectReadme(projectName, selection),
    ".agent-stack/manifest.json": manifest(selection),
  };

  if (has(selection, "vitest")) {
    files["vitest.config.ts"] = vitestConfig();
    files["tests/index.test.ts"] = exampleTest();
  }
  if (has(selection, "mutation-testing")) {
    files["stryker.config.mjs"] = strykerConfig();
  }
  if (has(selection, "github-actions")) {
    files[".github/workflows/ci.yml"] = githubWorkflow(selection);
  }
  if (has(selection, "gitleaks")) {
    files[".gitleaks.toml"] = text`
      title = "${projectName} gitleaks configuration"

      [extend]
      useDefault = true
    `;
  }
  if (has(selection, "agent-context")) {
    Object.assign(files, agentContextFiles(selection));
  }

  return files;
}

function packageJson(projectName: string, selection: FeatureSelection): string {
  const scripts: Record<string, string> = {
    dev: "tsx watch src/index.ts",
    build: "tsc -p tsconfig.build.json",
    typecheck: "tsc --noEmit",
  };
  const devDependencies: Record<string, string> = {
    "@types/node": "^22.15.30",
    tsx: "^4.20.3",
    typescript: "^5.8.3",
  };
  const checks: string[] = [];

  if (has(selection, "oxfmt")) {
    scripts.format = "oxfmt .";
    scripts["format:check"] = "oxfmt --check .";
    devDependencies.oxfmt = "^0.16.0";
    checks.push("pnpm format:check");
  }
  if (has(selection, "oxlint")) {
    scripts.lint = "oxlint .";
    devDependencies.oxlint = "^1.2.0";
    checks.push("pnpm lint");
  }

  checks.push("pnpm typecheck");

  if (has(selection, "vitest")) {
    scripts.test = "vitest run";
    devDependencies.vitest = "^3.2.2";
    checks.push("pnpm test");
  }
  if (has(selection, "mutation-testing")) {
    scripts.mutation = "stryker run";
    devDependencies["@stryker-mutator/core"] = "^10.0.0";
    devDependencies["@stryker-mutator/vitest-runner"] = "^10.0.0";
  }
  scripts.check = checks.join(" && ");

  return json({
    name: projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts,
    engines: { node: ">=22" },
    packageManager: "pnpm@10.11.0",
    devDependencies,
  });
}

function tsconfig(selection: FeatureSelection): string {
  const include = ["src/**/*.ts"];
  const types = ["node"];
  if (has(selection, "vitest")) {
    include.push("tests/**/*.ts");
    types.push("vitest/globals");
  }

  return json({
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      types,
      skipLibCheck: true,
    },
    include,
  });
}

function sourceEntryPoint(): string {
  return text`
    export function greet(name: string): string {
      const normalizedName = name.trim();
      if (normalizedName.length === 0) {
        throw new Error("A non-empty name is required to create a greeting.");
      }
      return \`Hello, \${normalizedName}!\`;
    }

    if (process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js")) {
      process.stdout.write(\`\${greet("agent")}\\n\`);
    }
  `;
}

function vitestConfig(): string {
  return text`
    import { defineConfig } from "vitest/config";

    export default defineConfig({
      test: {
        include: ["tests/**/*.test.ts"],
      },
    });
  `;
}

function strykerConfig(): string {
  return text`
    export default {
      testRunner: "vitest",
      plugins: ["@stryker-mutator/vitest-runner"],
      reporters: ["clear-text", "html"],
      mutate: ["src/**/*.ts"],
    };
  `;
}

function exampleTest(): string {
  return text`
    import { describe, expect, it } from "vitest";

    import { greet } from "../src/index.js";

    describe("greet", () => {
      it("creates a greeting for a named recipient", () => {
        expect(
          greet("developer"),
          "Expected greet(name) to preserve the supplied recipient in the greeting.",
        ).toBe("Hello, developer!");
      });

      it("explains why an empty recipient is invalid", () => {
        expect(() => greet("   ")).toThrow("A non-empty name is required to create a greeting.");
      });
    });
  `;
}

function githubWorkflow(selection: FeatureSelection): string {
  const securitySteps = [
    has(selection, "dependency-audit") ? "            - run: pnpm audit --audit-level high" : "",
    has(selection, "gitleaks")
      ? text`
                      - uses: gitleaks/gitleaks-action@v2
                        env:
                          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        `.trimEnd()
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return text`
    name: CI

    on:
      pull_request:
      push:
        branches: [main]

    permissions:
      contents: read

    jobs:
      verify:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
            with:
              fetch-depth: 0
          - uses: pnpm/action-setup@v4
            with:
              version: 10.11.0
          - uses: actions/setup-node@v4
            with:
              node-version: 22
              cache: pnpm
          - run: pnpm install --frozen-lockfile
          - run: pnpm check
    ${securitySteps}
  `;
}

function projectReadme(projectName: string, selection: FeatureSelection): string {
  const origin =
    selection.mode === "preset"
      ? `the ${selection.preset[0]?.toUpperCase()}${selection.preset.slice(1)} preset`
      : "individually selected features";
  const commands = [
    "- `pnpm dev` — run the entry point in watch mode.",
    "- `pnpm build` — compile production output.",
    has(selection, "vitest") ? "- `pnpm test` — run unit tests." : "",
    has(selection, "mutation-testing") ? "- `pnpm mutation` — run Stryker mutation tests." : "",
    "- `pnpm check` — run every configured project check.",
  ]
    .filter(Boolean)
    .join("\n");

  return text`
    # ${projectName}

    This project was generated by create-agent-stack with ${origin}.

    ## Requirements

    - Node.js 22 or newer
    - pnpm 10.11.0

    ## Selected features

    ${selection.features.map((feature) => `- \`${feature}\``).join("\n")}

    ## Commands

    ${commands}

    Add capabilities progressively and record each addition in \`.agent-stack/manifest.json\`.
  `;
}

function agentContextFiles(selection: FeatureSelection): Readonly<Record<string, string>> {
  return {
    "AGENTS.md": text`
      # Agent instructions

      1. Read \`README.md\`, \`docs/GLOSSARY.md\`, and \`.agent-stack/progress.json\` before changing code.
      2. Work on one feature at a time and leave the repository in a passing state.
      3. Run \`pnpm check\` before declaring work complete.
      4. Update documentation and progress records when behavior, boundaries, or invariants change.
      5. Never weaken or remove a failing check merely to make it pass.
    `,
    "docs/GLOSSARY.md": text`
      # Glossary

      - **Agent stack:** The selected tools and project artifacts that constrain and guide coding agents.
      - **Feature:** One independently verifiable capability installed by the scaffolder.
      - **Project check:** The aggregate \`pnpm check\` command that must pass before work is complete.
      - **Progress manifest:** The structured record used to continue work across agent sessions.
    `,
    ".agent-stack/progress.json": json({
      schemaVersion: 1,
      currentMilestone: "project-generated",
      completed: ["project-generated"],
      selectedFeatures: selection.features,
      next: "Define the first product feature before adding implementation code.",
    }),
  };
}

function manifest(selection: FeatureSelection): string {
  if (selection.mode === "preset") {
    return json({
      schemaVersion: 1,
      preset: selection.preset,
      features: selection.features,
    });
  }

  return json({
    schemaVersion: 1,
    selection: {
      mode: "features",
      requested: selection.requested,
      resolved: selection.features,
    },
    features: selection.features,
  });
}

function has(selection: FeatureSelection, feature: FeatureId): boolean {
  return selection.features.includes(feature);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function text(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  const raw = String.raw({ raw: strings }, ...values);
  const lines = raw.replace(/^\n/, "").split("\n");
  const indentation = Math.min(
    ...lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^\s*/)?.[0].length ?? 0),
  );
  return `${lines
    .map((line) => line.slice(indentation))
    .join("\n")
    .trimEnd()}\n`;
}
