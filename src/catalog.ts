export const presets = ["minimum"] as const;

export type Preset = (typeof presets)[number];

export interface FeatureSelection {
  readonly preset: Preset;
  readonly features: readonly string[];
}

export const minimumSelection: FeatureSelection = {
  preset: "minimum",
  features: [
    "typescript-node-pnpm",
    "oxfmt",
    "oxlint",
    "vitest",
    "obvious-scripts",
    "agent-context",
    "github-actions",
    "gitleaks",
    "dependency-audit",
  ],
};
