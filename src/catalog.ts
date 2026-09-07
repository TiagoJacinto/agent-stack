export const presets = ["minimum", "low"] as const;

export type Preset = (typeof presets)[number];

export const coreFeatures = ["typescript-node-pnpm", "obvious-scripts"] as const;

export const featureCatalog = [
  { id: "oxfmt", label: "Formatting", parent: null, dependencies: [] },
  { id: "oxlint", label: "Linting", parent: null, dependencies: [] },
  { id: "anti-slop", label: "Anti-slop", parent: "oxlint", dependencies: ["oxlint"] },
  {
    id: "anti-slop-effect",
    label: "Anti-slop Effect",
    parent: "anti-slop",
    dependencies: ["anti-slop"],
  },
  { id: "eslint", label: "ESLint", parent: null, dependencies: [] },
  { id: "ultracite", label: "Ultracite", parent: null, dependencies: [] },
  { id: "vitest", label: "Unit testing", parent: null, dependencies: [] },
  {
    id: "property-testing",
    label: "Property-based testing",
    parent: null,
    dependencies: ["vitest"],
  },
  {
    id: "mutation-testing",
    label: "Mutation testing",
    parent: null,
    dependencies: ["vitest"],
  },
  { id: "agent-context", label: "Agent context", parent: null, dependencies: [] },
  { id: "github-actions", label: "GitHub Actions", parent: null, dependencies: [] },
  { id: "gitleaks", label: "Secret scanning", parent: null, dependencies: ["github-actions"] },
  {
    id: "dependency-audit",
    label: "Dependency auditing",
    parent: null,
    dependencies: ["github-actions"],
  },
] as const;

export type OptionalFeatureId = (typeof featureCatalog)[number]["id"];
export type CoreFeatureId = (typeof coreFeatures)[number];
export type FeatureId = CoreFeatureId | OptionalFeatureId;

export const linterFeatures = ["oxlint", "eslint"] as const;
export type LinterFeatureId = (typeof linterFeatures)[number];

export interface PresetFeatureSelection {
  readonly mode: "preset";
  readonly preset: Preset;
  readonly requested: readonly OptionalFeatureId[];
  readonly features: readonly FeatureId[];
  readonly omitted: readonly OptionalFeatureId[];
}

export interface CustomFeatureSelection {
  readonly mode: "features";
  readonly requested: readonly OptionalFeatureId[];
  readonly features: readonly FeatureId[];
  readonly omitted: readonly OptionalFeatureId[];
}

export type FeatureSelection = PresetFeatureSelection | CustomFeatureSelection;

export interface SelectionWarning {
  readonly id: "ultracite-anti-slop-effect";
  readonly message: string;
  readonly omitted: readonly OptionalFeatureId[];
}

const minimumFeatures: readonly OptionalFeatureId[] = [
  "oxfmt",
  "oxlint",
  "anti-slop",
  "ultracite",
  "vitest",
  "agent-context",
  "github-actions",
  "gitleaks",
  "dependency-audit",
];

const lowFeatures: readonly OptionalFeatureId[] = [
  ...minimumFeatures,
  "property-testing",
  "mutation-testing",
];

export const minimumSelection: PresetFeatureSelection = {
  mode: "preset",
  preset: "minimum",
  requested: minimumFeatures,
  features: resolveFeatures(minimumFeatures),
  omitted: [],
};

export const lowSelection: PresetFeatureSelection = {
  mode: "preset",
  preset: "low",
  requested: lowFeatures,
  features: resolveFeatures(lowFeatures),
  omitted: [],
};

export function createFeatureSelection(
  requested: readonly OptionalFeatureId[],
): CustomFeatureSelection {
  return {
    mode: "features",
    requested: unique(requested),
    features: resolveFeatures(requested),
    omitted: [],
  };
}

export function omitFeatures(
  selection: FeatureSelection,
  omitted: readonly OptionalFeatureId[],
): FeatureSelection {
  const omittedSet = new Set<string>([...selection.omitted, ...omitted]);
  return {
    ...selection,
    features: selection.features.filter((feature) => !omittedSet.has(feature)),
    omitted: [...omittedSet] as OptionalFeatureId[],
  };
}

export function selectionWarnings(selection: FeatureSelection): readonly SelectionWarning[] {
  if (has(selection, "ultracite") && has(selection, "anti-slop-effect")) {
    return [
      {
        id: "ultracite-anti-slop-effect",
        message: "Ultracite does not support anti-slop-effect. It will not be applied.",
        omitted: ["anti-slop-effect"],
      },
    ];
  }

  return [];
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

function has(selection: FeatureSelection, feature: OptionalFeatureId): boolean {
  return selection.features.includes(feature);
}
