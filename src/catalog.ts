export const presets = ["minimum", "low", "medium", "high", "maximum"] as const;

export type Preset = (typeof presets)[number];

export const packageManagers = ["pnpm", "bun"] as const;

export type PackageManager = (typeof packageManagers)[number];

export const packageManagerVersions: Readonly<Record<PackageManager, string>> = {
  pnpm: "10.11.0",
  bun: "1.3.14",
};

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
export type CoreFeatureId = "typescript-node-pnpm" | "typescript-node-bun" | "obvious-scripts";
export type FeatureId = CoreFeatureId | OptionalFeatureId;

export const linterFeatures = ["oxlint", "eslint"] as const;
export type LinterFeatureId = (typeof linterFeatures)[number];

export interface PresetFeatureSelection {
  readonly mode: "preset";
  readonly preset: Preset;
  readonly packageManager: PackageManager;
  readonly requested: readonly OptionalFeatureId[];
  readonly features: readonly FeatureId[];
  readonly omitted: readonly OptionalFeatureId[];
}

export interface CustomFeatureSelection {
  readonly mode: "features";
  readonly packageManager: PackageManager;
  readonly requested: readonly OptionalFeatureId[];
  readonly features: readonly FeatureId[];
  readonly omitted: readonly OptionalFeatureId[];
}

export type FeatureSelection = PresetFeatureSelection | CustomFeatureSelection;

export type ShippingGate = string;

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

const lowFeatures: readonly OptionalFeatureId[] = [...minimumFeatures];

const highFeatures: readonly OptionalFeatureId[] = [
  ...lowFeatures,
  "property-testing",
  "mutation-testing",
];

const shippingGatesByPreset: Readonly<Record<Preset, readonly ShippingGate[]>> = {
  minimum: [
    "successful build",
    "formatting and linting",
    "type checking",
    "existing tests",
    "secret scanning",
    "dependency auditing",
    "narrow change scope",
    "basic agent compute budget",
  ],
  low: [
    "successful build",
    "formatting and linting",
    "type checking",
    "existing tests",
    "secret scanning",
    "dependency auditing",
    "narrow change scope",
    "basic agent compute budget",
    "changed-behavior unit tests",
    "basic input and error handling",
    "dead-code and simple complexity/file-size limits",
  ],
  medium: [
    "successful build",
    "formatting and linting",
    "type checking",
    "existing tests",
    "secret scanning",
    "dependency auditing",
    "narrow change scope",
    "basic agent compute budget",
    "changed-behavior unit tests",
    "basic input and error handling",
    "dead-code and simple complexity/file-size limits",
    "changed-code coverage, SAST, and contract checks",
    "UI accessibility and performance smoke tests",
    "duplication limits and reviewable diff explanation",
  ],
  high: [
    "successful build",
    "formatting and linting",
    "type checking",
    "existing tests",
    "secret scanning",
    "dependency auditing",
    "narrow change scope",
    "basic agent compute budget",
    "changed-behavior unit tests",
    "basic input and error handling",
    "dead-code and simple complexity/file-size limits",
    "changed-code coverage, SAST, and contract checks",
    "UI accessibility and performance smoke tests",
    "duplication limits and reviewable diff explanation",
    "property tests and mutation testing for critical modules",
    "end-to-end, load, failure, retry, and concurrency tests",
    "WCAG, license/SBOM, architecture, and strict complexity checks",
  ],
  maximum: [
    "successful build",
    "formatting and linting",
    "type checking",
    "existing tests",
    "secret scanning",
    "dependency auditing",
    "narrow change scope",
    "basic agent compute budget",
    "changed-behavior unit tests",
    "basic input and error handling",
    "dead-code and simple complexity/file-size limits",
    "changed-code coverage, SAST, and contract checks",
    "UI accessibility and performance smoke tests",
    "duplication limits and reviewable diff explanation",
    "property tests and mutation testing for critical modules",
    "end-to-end, load, failure, retry, and concurrency tests",
    "WCAG, license/SBOM, architecture, and strict complexity checks",
    "adversarial trust-boundary fuzzing and DAST checks",
    "stress/soak, compatibility-matrix, and chaos checks",
    "provenance/signing, critical-surface reviews, formal verification where justified, and independent approval",
  ],
};

export const minimumSelection: PresetFeatureSelection = makePresetSelection(
  "minimum",
  minimumFeatures,
);

export const lowSelection: PresetFeatureSelection = makePresetSelection("low", lowFeatures);

export const mediumSelection: PresetFeatureSelection = makePresetSelection("medium", lowFeatures);

export const highSelection: PresetFeatureSelection = makePresetSelection("high", highFeatures);

export const maximumSelection: PresetFeatureSelection = makePresetSelection(
  "maximum",
  highFeatures,
);

export function presetSelection(
  preset: Preset,
  packageManager: PackageManager = "pnpm",
): PresetFeatureSelection {
  switch (preset) {
    case "minimum":
      return packageManager === "pnpm"
        ? minimumSelection
        : makePresetSelection("minimum", minimumFeatures, packageManager);
    case "low":
      return makePresetSelection("low", lowFeatures, packageManager);
    case "medium":
      return makePresetSelection("medium", lowFeatures, packageManager);
    case "high":
      return makePresetSelection("high", highFeatures, packageManager);
    case "maximum":
      return makePresetSelection("maximum", highFeatures, packageManager);
    default:
      throw new Error(`Unknown preset: ${preset}`);
  }
}

function makePresetSelection(
  preset: Preset,
  requested: readonly OptionalFeatureId[],
  packageManager: PackageManager = "pnpm",
): PresetFeatureSelection {
  return {
    mode: "preset",
    preset,
    packageManager,
    requested,
    features: resolveFeatures(requested, packageManager),
    omitted: [],
  };
}

export function shippingGates(selection: FeatureSelection): readonly ShippingGate[] {
  return selection.mode === "preset" ? shippingGatesByPreset[selection.preset] : [];
}

export function createFeatureSelection(
  requested: readonly OptionalFeatureId[],
  packageManager: PackageManager = "pnpm",
): CustomFeatureSelection {
  return {
    mode: "features",
    packageManager,
    requested: unique(requested),
    features: resolveFeatures(requested, packageManager),
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

export function resolveFeatures(
  requested: readonly OptionalFeatureId[],
  packageManager: PackageManager = "pnpm",
): readonly FeatureId[] {
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

  const corePackageManager = `typescript-node-${packageManager}` as CoreFeatureId;
  return [
    corePackageManager,
    "obvious-scripts",
    ...featureCatalog.flatMap(({ id }) => (selected.has(id) ? [id] : [])),
  ];
}

function unique(features: readonly OptionalFeatureId[]): readonly OptionalFeatureId[] {
  return [...new Set(features)];
}

function has(selection: FeatureSelection, feature: OptionalFeatureId): boolean {
  return selection.features.includes(feature);
}
