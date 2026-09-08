import { shippingGates, type FeatureId, type FeatureSelection } from "./catalog.js";
import { antiSlopAssets } from "./anti-slop-assets.js";

const eslintSupportDependencies = {
  "@typescript-eslint/eslint-plugin": "^8.69.0",
  "@typescript-eslint/parser": "^8.69.0",
  "eslint-config-prettier": "^10.1.8",
  "eslint-import-resolver-typescript": "^4.4.5",
  "eslint-plugin-compat": "^7.0.2",
  "eslint-plugin-cypress": "^7.0.1",
  "eslint-plugin-github": "6.1.2",
  "eslint-plugin-html": "^8.2.0",
  "eslint-plugin-import-x": "^4.17.1",
  "eslint-plugin-jsdoc": "^64.3.5",
  "eslint-plugin-n": "^18.3.0",
  "eslint-plugin-prettier": "^5.5.6",
  "eslint-plugin-promise": "^7.3.0",
  "eslint-plugin-sonarjs": "^4.2.0",
  "eslint-plugin-storybook": "^10.6.0",
  "eslint-plugin-unicorn": "^74.0.0",
  "eslint-plugin-unused-imports": "^4.4.1",
  globals: "^17.12.0",
  prettier: "^3.9.6",
} as const;

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

  if (selection.mode === "preset") {
    files[".agent-stack/shipping-gates.json"] = shippingGatePolicy(selection);
  }

  if (has(selection, "oxlint")) {
    files["oxlint.config.ts"] = oxlintConfig(selection);
    if (has(selection, "anti-slop") && !has(selection, "ultracite")) {
      Object.assign(files, antiSlopAssets);
    }
  }
  if (has(selection, "eslint")) {
    files["eslint.config.mjs"] = eslintConfig(selection);
  }
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
  const lintCommands: string[] = [];
  const lintTargets = has(selection, "vitest") ? "src tests" : "src";

  if (has(selection, "oxfmt")) {
    scripts.format = "oxfmt .";
    scripts["format:check"] = "oxfmt --check .";
    devDependencies.oxfmt = "^0.16.0";
    checks.push("pnpm format:check");
  }
  if (has(selection, "oxlint")) {
    devDependencies.oxlint = "^1.81.0";
    lintCommands.push(has(selection, "eslint") ? `oxlint ${lintTargets}` : "oxlint .");
  }
  if (has(selection, "eslint")) {
    devDependencies.eslint = "^10.9.1";
    lintCommands.push(`eslint ${lintTargets}`);
    if (has(selection, "ultracite")) {
      Object.assign(devDependencies, eslintSupportDependencies);
    }
  }
  if (lintCommands.length > 0) {
    scripts.lint = lintCommands.join(" && ");
    checks.push("pnpm lint");
  }
  if (has(selection, "anti-slop") && !has(selection, "ultracite")) {
    devDependencies["@oxlint/plugins"] = "1.81.0";
  }
  if (has(selection, "ultracite")) {
    devDependencies.ultracite = "^7.10.8";
  }

  checks.push("pnpm typecheck");

  if (has(selection, "vitest")) {
    scripts.test = "vitest run";
    devDependencies.vitest = "^3.2.2";
    checks.push("pnpm test");
  }
  if (has(selection, "property-testing")) {
    devDependencies["@fast-check/vitest"] = "^0.3.0";
    devDependencies["fast-check"] = "^4.9.0";
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
    export const greet = (name: string): string => {
      const normalizedName = name.trim();
      if (normalizedName.length === 0) {
        throw new Error("A non-empty name is required to create a greeting.");
      }
      return \`Hello, \${normalizedName}!\`;
    };

    if (
      process.argv[1]?.endsWith("index.ts") === true ||
      process.argv[1]?.endsWith("index.js") === true
    ) {
      process.stdout.write(\`\${greet("agent")}\\n\`);
    }
  `;
}

function eslintConfig(selection: FeatureSelection): string {
  if (!has(selection, "ultracite")) return "export default [];\n";

  return ['import core from "ultracite/eslint/core";', "", "export default core;", ""].join("\n");
}

function oxlintConfig(selection: FeatureSelection): string {
  const imports = [
    'import { defineConfig } from "oxlint";',
    has(selection, "ultracite") ? 'import core from "ultracite/oxlint/core";' : "",
    has(selection, "ultracite") && has(selection, "anti-slop")
      ? 'import antislop from "ultracite/oxlint/anti-slop";'
      : "",
  ].filter(Boolean);

  if (has(selection, "ultracite")) {
    const extendsValue = has(selection, "anti-slop") ? "core, antislop" : "core";
    return [
      ...imports,
      "",
      "export default defineConfig({",
      `  extends: [${extendsValue}],`,
      "  ignorePatterns: core.ignorePatterns,",
      "});",
      "",
    ].join("\n");
  }

  const plugins = [
    has(selection, "anti-slop")
      ? [
          "    {",
          '      name: "anti-slop",',
          '      specifier: "./tools/oxlint/anti-slop/index.ts",',
          "    },",
        ]
      : [],
    has(selection, "anti-slop-effect")
      ? [
          "    {",
          '      name: "anti-slop-effect",',
          '      specifier: "./tools/oxlint/anti-slop/effect/index.ts",',
          "    },",
        ]
      : [],
  ].flat();

  if (plugins.length === 0) return `${imports.join("\n")}\n\nexport default defineConfig({});\n`;

  return [
    ...imports,
    "",
    "export default defineConfig({",
    "  jsPlugins: [",
    ...plugins,
    "  ],",
    "});",
    "",
  ].join("\n");
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
      mutate: ["src/**/*.ts"],
      plugins: ["@stryker-mutator/vitest-runner"],
      reporters: ["clear-text", "html"],
      testRunner: "vitest",
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
  const lines = [
    "name: CI",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: pnpm/action-setup@v4",
    "        with:",
    "          version: 10.11.0",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    "          cache: pnpm",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm check",
  ];
  if (has(selection, "dependency-audit")) lines.push("      - run: pnpm audit --audit-level high");
  if (has(selection, "gitleaks")) {
    lines.push(
      "      - uses: gitleaks/gitleaks-action@v2",
      "        env:",
      "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    );
  }
  return `${lines.join("\n")}\n`;
}

function shippingGatePolicy(selection: Extract<FeatureSelection, { mode: "preset" }>): string {
  return json({
    preset: selection.preset,
    recommendation: selection.preset === "medium" ? "default-production" : undefined,
    gates: shippingGates(selection),
  });
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

    ## Shipping policy

    ${selection.mode === "preset" ? `This project uses the ${selection.preset} shipping preset. Review \`.agent-stack/shipping-gates.json\` before declaring a change shippable.` : "Select a shipping preset when the project needs a defined release gate."}
    ${selection.mode === "preset" && selection.preset === "medium" ? "Medium is the default recommendation for production projects." : ""}

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
      ...(selection.omitted.length > 0 ? { omitted: selection.omitted } : {}),
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
