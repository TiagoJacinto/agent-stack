export const presets = ["minimum", "low"] as const;

export type Preset = (typeof presets)[number];

export const coreFeatures = ["typescript-node-pnpm", "obvious-scripts"] as const;

export const featureCatalog = [
  { id: "oxfmt", label: "Formatting", dependencies: [] },
  { id: "oxlint", label: "Linting", dependencies: [] },
  { id: "vitest", label: "Unit testing", dependencies: [] },
  { id: "mutation-testing", label: "Mutation testing", dependencies: ["vitest"] },
  { id: "agent-context", label: "Agent context", dependencies: [] },
  { id: "github-actions", label: "GitHub Actions", dependencies: [] },
  { id: "gitleaks", label: "Secret scanning", dependencies: ["github-actions"] },
  { id: "dependency-audit", label: "Dependency auditing", dependencies: ["github-actions"] },
] as const;

export type OptionalFeatureId = (typeof featureCatalog)[number]["id"];
export type CoreFeatureId = (typeof coreFeatures)[number];
export type FeatureId = CoreFeatureId | OptionalFeatureId;

export interface PresetFeatureSelection {
  readonly mode: "preset";
  readonly preset: Preset;
  readonly requested: readonly OptionalFeatureId[];
  readonly features: readonly FeatureId[];
}

export interface CustomFeatureSelection {
  readonly mode: "features";
  readonly requested: readonly OptionalFeatureId[];
  readonly features: readonly FeatureId[];
}

export type FeatureSelection = PresetFeatureSelection | CustomFeatureSelection;

const minimumFeatures: readonly OptionalFeatureId[] = [
  "oxfmt",
  "oxlint",
  "vitest",
  "agent-context",
  "github-actions",
  "gitleaks",
  "dependency-audit",
];

const lowFeatures: readonly OptionalFeatureId[] = [...minimumFeatures, "mutation-testing"];

export const minimumSelection: PresetFeatureSelection = {
  mode: "preset",
  preset: "minimum",
  requested: minimumFeatures,
  features: resolveFeatures(minimumFeatures),
};

export const lowSelection: PresetFeatureSelection = {
  mode: "preset",
  preset: "low",
  requested: lowFeatures,
  features: resolveFeatures(lowFeatures),
};

export function createFeatureSelection(
  requested: readonly OptionalFeatureId[],
): CustomFeatureSelection {
  return {
    mode: "features",
    requested: unique(requested),
    features: resolveFeatures(requested),
  };
}

export function resolveFeatures(requested: readonly OptionalFeatureId[]): readonly FeatureId[] {
  const selected = new Set<OptionalFeatureId>();

  const include = (id: OptionalFeatureId): void => {
    if (selected.has(id)) return;
    const feature = featureCatalog.find((candidate) => candidate.id === id);
    if (feature === undefined) {
      throw new Error(`Unknown feature: ${id}`);
    }
    for (const dependency of feature.dependencies) include(dependency);
    selected.add(id);
  };

  for (const id of requested) include(id);

  return [
    ...coreFeatures,
    ...featureCatalog.filter(({ id }) => selected.has(id)).map(({ id }) => id),
  ];
}

function unique(features: readonly OptionalFeatureId[]): readonly OptionalFeatureId[] {
  return [...new Set(features)];
}
