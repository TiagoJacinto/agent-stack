export interface Reconciliation {
  readonly content: string;
  readonly changed: boolean;
  readonly conflicts: readonly string[];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const markdownStart = "<!-- agent-stack:start -->";
const markdownEnd = "<!-- agent-stack:end -->";

export function prepareNewFile(relativePath: string, generatedContent: string): string {
  if (relativePath === "package.json") return mergePackageJson("{}", generatedContent);
  if (relativePath.endsWith(".md")) return mergeMarkdown("", generatedContent);
  return generatedContent;
}

export function reconcileFile(
  relativePath: string,
  existingContent: string,
  generatedContent: string,
): Reconciliation {
  if (existingContent === generatedContent) {
    return { content: existingContent, changed: false, conflicts: [] };
  }

  if (relativePath === "package.json") {
    return reconciled(mergePackageJson(existingContent, generatedContent));
  }
  if (relativePath === "tsconfig.json" || relativePath === "tsconfig.build.json") {
    return mergeJsonFile(relativePath, existingContent, generatedContent);
  }
  if (relativePath === ".agent-stack/manifest.json") {
    return reconciled(mergeManifest(existingContent, generatedContent));
  }
  if (relativePath === ".agent-stack/progress.json") {
    return reconciled(mergePreservingExisting(existingContent, generatedContent));
  }
  if (relativePath === ".gitignore") {
    return reconciled(mergeGitignore(existingContent, generatedContent));
  }
  if (relativePath.endsWith(".md")) {
    return reconciled(mergeMarkdown(existingContent, generatedContent));
  }
  if (relativePath === "oxlint.config.ts") {
    return mergeOxlintConfig(existingContent, generatedContent);
  }
  if (relativePath === "eslint.config.mjs") {
    return mergeEslintConfig(existingContent, generatedContent);
  }
  if (relativePath === "vitest.config.ts") {
    return mergeVitestConfig(existingContent, generatedContent);
  }
  if (relativePath === "stryker.config.mjs") {
    return mergeObjectConfig(existingContent, generatedContent);
  }
  if (relativePath === ".github/workflows/ci.yml") {
    return reconciled(mergeWorkflow(existingContent, generatedContent));
  }

  return {
    content: existingContent,
    changed: false,
    conflicts: [relativePath],
  };
}

function reconciled(content: string): Reconciliation {
  return { content, changed: true, conflicts: [] };
}

function mergeJsonFile(
  relativePath: string,
  existingContent: string,
  generatedContent: string,
): Reconciliation {
  const existing = parseJsonObject(relativePath, existingContent);
  const generated = parseJsonObject(relativePath, generatedContent);
  const conflicts: string[] = [];
  const merged = mergeJsonValue(existing, generated, relativePath, conflicts);

  return {
    content: `${JSON.stringify(merged, null, 2)}\n`,
    changed: conflicts.length === 0,
    conflicts,
  };
}

function parseJsonObject(relativePath: string, content: string): JsonObject {
  try {
    const normalized = removeJsonTrailingCommas(stripJsonComments(content));
    const parsed: unknown = JSON.parse(normalized);
    if (!isJsonObject(parsed)) throw new Error("the root value is not an object");
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot merge ${relativePath}: ${detail}`);
  }
}

function stripJsonComments(content: string): string {
  let result = "";
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const nextCharacter = content[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += character;
      } else {
        result += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote.length > 0) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"') {
      quote = character;
      result += character;
    } else if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
    } else if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
    } else {
      result += character;
    }
  }
  return result;
}

function removeJsonTrailingCommas(content: string): string {
  let result = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (quote.length > 0) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"') {
      quote = character;
      result += character;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(content[next] ?? "")) next += 1;
      if (content[next] === "}" || content[next] === "]") continue;
    }
    result += character;
  }
  return result;
}

function mergeJsonValue(
  existing: JsonValue,
  generated: JsonValue,
  path: string,
  conflicts: string[],
): JsonValue {
  if (isJsonObject(existing) && isJsonObject(generated)) {
    const merged: JsonObject = { ...generated };
    for (const [key, existingValue] of Object.entries(existing)) {
      const generatedValue = generated[key];
      merged[key] =
        generatedValue === undefined
          ? existingValue
          : mergeJsonValue(existingValue, generatedValue, `${path}.${key}`, conflicts);
    }
    return merged;
  }

  if (Array.isArray(existing) && Array.isArray(generated)) {
    return uniqueJsonValues([...generated, ...existing]);
  }

  if (Object.is(existing, generated)) return existing;
  conflicts.push(path);
  return existing;
}

function mergePackageJson(existingContent: string, generatedContent: string): string {
  const existing = parseJsonObject("package.json", existingContent);
  const generated = parseJsonObject("package.json", generatedContent);
  const merged: JsonObject = { ...generated, ...existing };

  for (const key of ["scripts", "dependencies", "devDependencies"]) {
    merged[key] = mergePreservingExistingValue(generated[key], existing[key]);
  }

  const scripts = isJsonObject(merged.scripts) ? merged.scripts : undefined;
  const existingScripts = isJsonObject(existing.scripts) ? existing.scripts : undefined;
  if (scripts?.test === "vitest run" && existingScripts?.test === undefined) {
    scripts.test = "vitest run --passWithNoTests";
  }

  return `${JSON.stringify(merged, null, 2)}\n`;
}

function mergeManifest(existingContent: string, generatedContent: string): string {
  const existing = parseJsonObject(".agent-stack/manifest.json", existingContent);
  const generated = parseJsonObject(".agent-stack/manifest.json", generatedContent);
  const merged: JsonObject = { ...generated, ...existing };
  merged.features = uniqueJsonValues([
    ...asJsonArray(generated.features),
    ...asJsonArray(existing.features),
  ]);

  if (isJsonObject(generated.selection) && isJsonObject(existing.selection)) {
    const selection: JsonObject = { ...generated.selection, ...existing.selection };
    selection.resolved = uniqueJsonValues([
      ...asJsonArray(generated.selection.resolved),
      ...asJsonArray(existing.selection.resolved),
    ]);
    merged.selection = selection;
  }

  if (existing.preset === undefined && generated.preset !== undefined) {
    merged.preset = generated.preset;
  }

  return `${JSON.stringify(merged, null, 2)}\n`;
}

function mergePreservingExisting(existingContent: string, generatedContent: string): string {
  const existing = parseJsonObject("JSON artifact", existingContent);
  const generated = parseJsonObject("JSON artifact", generatedContent);
  return `${JSON.stringify(mergePreservingExistingValue(generated, existing), null, 2)}\n`;
}

function mergePreservingExistingValue(
  generated: JsonValue | undefined,
  existing: JsonValue | undefined,
): JsonValue {
  if (generated === undefined) return existing ?? null;
  if (existing === undefined) return generated;
  if (isJsonObject(generated) && isJsonObject(existing)) {
    const merged: JsonObject = { ...generated, ...existing };
    for (const [key, generatedValue] of Object.entries(generated)) {
      merged[key] = mergePreservingExistingValue(generatedValue, existing[key]);
    }
    return merged;
  }
  if (Array.isArray(generated) && Array.isArray(existing)) {
    return uniqueJsonValues([...generated, ...existing]);
  }
  return existing;
}

function mergeGitignore(existingContent: string, generatedContent: string): string {
  const existingLines = existingContent.split(/\r?\n/).filter((line) => line.length > 0);
  const existingSet = new Set(existingLines);
  const additions = generatedContent
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !existingSet.has(line));
  return `${[...existingLines, ...additions].join("\n")}\n`;
}

function mergeMarkdown(existingContent: string, generatedContent: string): string {
  const block = `${markdownStart}\n${generatedContent.trim()}\n${markdownEnd}`;
  const managedBlock = new RegExp(
    `${escapeRegExp(markdownStart)}[\\s\\S]*?${escapeRegExp(markdownEnd)}`,
  );
  if (managedBlock.test(existingContent)) return existingContent.replace(managedBlock, block);
  return `${existingContent.trimEnd()}\n\n${block}\n`;
}

function mergeOxlintConfig(existingContent: string, generatedContent: string): Reconciliation {
  const imports = mergeImports(existingContent, generatedContent, "oxlint.config.ts");
  if (imports.conflicts.length > 0) {
    return { content: existingContent, changed: false, conflicts: imports.conflicts };
  }
  let merged = imports.content;
  if (!existingContent.includes("defineConfig(")) {
    merged = merged.replace(/^import \{ defineConfig \} from "oxlint";\n?/m, "");
  }
  const generatedExtends = arrayEntries(generatedContent, "extends").map((entry) =>
    resolveImportedIdentifier(entry, generatedContent, merged),
  );
  if (generatedExtends.length > 0) {
    const result = mergeArrayProperty(
      merged,
      "extends",
      generatedExtends,
      configObjectOpen(merged),
      "oxlint.config.ts.extends",
    );
    if (result.conflicts.length > 0) {
      return { content: existingContent, changed: false, conflicts: result.conflicts };
    }
    merged = result.content;
  }

  const generatedPlugins = pluginEntries(generatedContent);
  if (generatedPlugins.length > 0) {
    const plugins = mergePlugins(merged, generatedPlugins);
    if (plugins.conflicts.length > 0) {
      return { content: existingContent, changed: false, conflicts: plugins.conflicts };
    }
    merged = plugins.content;
  }

  const generatedIgnorePatterns = propertyLine(generatedContent, "ignorePatterns");
  if (
    generatedIgnorePatterns !== undefined &&
    topLevelProperty(merged, configObjectOpen(merged), "ignorePatterns") === undefined
  ) {
    merged = insertConfigProperty(merged, generatedIgnorePatterns);
  }

  if (!hasConfigObject(merged)) {
    return { content: existingContent, changed: false, conflicts: ["oxlint.config.ts"] };
  }
  return reconciled(merged);
}

function mergeEslintConfig(existingContent: string, generatedContent: string): Reconciliation {
  const generatedImports = importLines(generatedContent);
  if (generatedImports.length === 0)
    return { content: existingContent, changed: false, conflicts: [] };

  const imports = mergeImports(existingContent, generatedContent, "eslint.config.mjs");
  if (imports.conflicts.length > 0) {
    return { content: existingContent, changed: false, conflicts: imports.conflicts };
  }
  let merged = imports.content;

  const exportExpression = defaultExportExpression(merged);
  if (exportExpression === undefined) {
    return {
      content: existingContent,
      changed: false,
      conflicts: ["eslint.config.mjs:export default"],
    };
  }

  const expression = exportExpression.expression;
  const coreLocals = importLines(merged)
    .flatMap((line) => importBindings(line))
    .filter((binding) => binding.source === "ultracite/eslint/core")
    .map((binding) => binding.local);
  if (
    coreLocals.some(
      (local) =>
        expression.trim() === local ||
        (expression.startsWith("[") &&
          arrayValueEntries(expression).some((entry) => entry.trim() === local)),
    )
  ) {
    return reconciled(merged);
  }
  let replacement: string;
  if (expression.startsWith("[")) {
    const entries = expression.slice(1, -1).trim();
    replacement =
      entries.length === 0 ? "[core]" : `[${entries}${entries.endsWith(",") ? "" : ","} core]`;
  } else {
    replacement = `[${expression}, core]`;
  }
  merged =
    merged.slice(0, exportExpression.start) +
    `export default ${replacement};` +
    merged.slice(exportExpression.end);
  return reconciled(merged);
}

function mergeVitestConfig(existingContent: string, generatedContent: string): Reconciliation {
  const imports = mergeImports(existingContent, generatedContent, "vitest.config.ts");
  if (imports.conflicts.length > 0) {
    return { content: existingContent, changed: false, conflicts: imports.conflicts };
  }
  let merged = imports.content;
  const generatedInclude = arrayEntries(generatedContent, "include");
  if (generatedInclude.length > 0) {
    const testObject = propertyObjectOpen(merged, "test");
    if (testObject === undefined) {
      merged = insertConfigProperty(
        merged,
        `test: {\n  include: [${generatedInclude.join(", ")}]\n}`,
      );
    }
    const resolvedTestObject = propertyObjectOpen(merged, "test");
    if (resolvedTestObject === undefined) {
      return { content: existingContent, changed: false, conflicts: ["vitest.config.ts:test"] };
    }
    const result = mergeArrayProperty(
      merged,
      "include",
      generatedInclude,
      resolvedTestObject,
      "vitest.config.ts:test.include",
    );
    if (result.conflicts.length > 0) {
      return { content: existingContent, changed: false, conflicts: result.conflicts };
    }
    merged = result.content;
  }
  return reconciled(merged);
}

function mergeObjectConfig(existingContent: string, generatedContent: string): Reconciliation {
  const imports = mergeImports(existingContent, generatedContent, "stryker.config.mjs");
  if (imports.conflicts.length > 0) {
    return { content: existingContent, changed: false, conflicts: imports.conflicts };
  }
  let merged = imports.content;
  if (configObjectOpen(merged) < 0) {
    return {
      content: existingContent,
      changed: false,
      conflicts: ["stryker.config.mjs:export default"],
    };
  }
  const conflicts: string[] = [];
  for (const property of ["plugins", "reporters", "mutate"]) {
    const entries = arrayEntries(generatedContent, property);
    if (entries.length > 0) {
      const result = mergeArrayProperty(
        merged,
        property,
        entries,
        configObjectOpen(merged),
        `stryker.config.mjs.${property}`,
      );
      conflicts.push(...result.conflicts);
      merged = result.content;
    }
  }
  for (const line of generatedContent.split("\n")) {
    const match = /^\s{2}([A-Za-z][\w]*):\s*(.+),?$/.exec(line);
    if (match !== null && !hasProperty(merged, match[1] ?? "")) {
      merged = insertConfigProperty(merged, line.trimEnd());
    }
  }
  if (conflicts.length > 0) {
    return { content: existingContent, changed: false, conflicts };
  }
  return reconciled(merged);
}

function mergeWorkflow(existingContent: string, generatedContent: string): string {
  let lines = existingContent.split("\n");
  const existingOn = yamlSections(lines.join("\n"), 0).find((section) => section.name === "on");
  if (existingOn !== undefined) lines = normalizeFlowWorkflowTriggers(lines, existingOn);
  for (const section of yamlSections(generatedContent, 0)) {
    if (section.name === "name") continue;
    const existingSection = yamlSections(lines.join("\n"), 0).find(
      (candidate) => candidate.name === section.name,
    );
    if (existingSection === undefined) {
      lines = appendYamlBlock(lines, section.block);
      continue;
    }
    if (section.name === "on" || section.name === "jobs") {
      lines = mergeYamlChildren(
        lines,
        existingSection.name,
        section.block,
        section.name === "jobs",
      );
    }
  }
  return lines.join("\n");
}

function normalizeFlowWorkflowTriggers(lines: string[], section: YamlSection): string[] {
  const line = lines[section.start] ?? "";
  const indentation = line.match(/^\s*/)?.[0] ?? "";
  const keyValue = line.slice(indentation.length);
  const separator = inlineYamlColon(keyValue);
  if (separator < 0 || normalizeYamlScalar(keyValue.slice(0, separator)) !== "on") return lines;
  const inlineValue = keyValue.slice(separator + 1).trim();
  const commentStart = yamlCommentStart(inlineValue);
  const value = (commentStart < 0 ? inlineValue : inlineValue.slice(0, commentStart)).trim();
  const comment = commentStart < 0 ? "" : ` ${inlineValue.slice(commentStart).trim()}`;
  const triggers = inlineWorkflowTriggers(value);
  if (triggers.length === 0 && value.length === 0) return lines;
  const replacement = [
    `${indentation}on:`,
    ...triggers.flatMap(({ name, configuration }, index) => [
      `${indentation}  ${name}:${index === 0 ? comment : ""}`,
      ...inlineYamlProperties(configuration).map((entry) => `${indentation}    ${entry}`),
    ]),
  ];
  lines.splice(section.start, section.end - section.start, ...replacement);
  return lines;
}

type InlineWorkflowTrigger = {
  readonly name: string;
  readonly configuration?: string;
};

function inlineWorkflowTriggers(value: string): InlineWorkflowTrigger[] {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((trigger) => ({ name: normalizeYamlScalar(trigger) }))
      .filter(({ name }) => name.length > 0);
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    return splitInlineYamlEntries(value.slice(1, -1)).flatMap((entry) => {
      const separator = inlineYamlColon(entry);
      if (separator < 0) return [];
      const name = normalizeYamlScalar(entry.slice(0, separator));
      if (name.length === 0) return [];
      const configuration = entry.slice(separator + 1).trim();
      return [{ name, ...(configuration.length === 0 ? {} : { configuration }) }];
    });
  }
  const name = normalizeYamlScalar(value);
  return name.length === 0 ? [] : [{ name }];
}

function inlineYamlProperties(value: string | undefined): string[] {
  if (value === undefined || !value.startsWith("{") || !value.endsWith("}")) return [];
  return splitInlineYamlEntries(value.slice(1, -1));
}

function splitInlineYamlEntries(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let curlyDepth = 0;
  let bracketDepth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") curlyDepth += 1;
    if (character === "}") curlyDepth -= 1;
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth -= 1;
    if (character === "," && curlyDepth === 0 && bracketDepth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last.length > 0) entries.push(last);
  return entries;
}

function inlineYamlColon(value: string): number {
  let curlyDepth = 0;
  let bracketDepth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") curlyDepth += 1;
    if (character === "}") curlyDepth -= 1;
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth -= 1;
    if (character === ":" && curlyDepth === 0 && bracketDepth === 0) return index;
  }
  return -1;
}

function yamlCommentStart(value: string): number {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return index;
  }
  return -1;
}

function yamlValueWithoutComment(value: string): string {
  const commentStart = yamlCommentStart(value);
  return commentStart < 0 ? value : value.slice(0, commentStart);
}

type YamlSection = {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly block: string;
};

function yamlSections(content: string, indentation: number): YamlSection[] {
  const lines = content.split("\n");
  const sections: YamlSection[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const name = yamlKey(lines[index] ?? "", indentation);
    if (name === undefined) continue;
    const next = lines.findIndex(
      (line, candidateIndex) => candidateIndex > index && yamlKey(line, indentation) !== undefined,
    );
    const end = next < 0 ? lines.length : next;
    sections.push({
      name,
      start: index,
      end,
      block: lines.slice(index, end).join("\n"),
    });
  }
  return sections;
}

function yamlKey(line: string, indentation: number): string | undefined {
  const leadingWhitespace = line.match(/^\s*/)?.[0].length ?? 0;
  if (leadingWhitespace !== indentation) return undefined;
  const value = yamlValueWithoutComment(line.slice(indentation)).trim();
  if (value.startsWith("-")) return undefined;
  const separator = inlineYamlColon(value);
  if (separator <= 0) return undefined;
  const name = normalizeYamlScalar(value.slice(0, separator));
  return name.length > 0 && !name.includes(" ") ? name : undefined;
}

function mergeYamlChildren(
  lines: string[],
  sectionName: string,
  generatedBlock: string,
  mergeSteps: boolean,
): string[] {
  let merged = [...lines];
  for (const generatedChild of yamlSections(generatedBlock, 2)) {
    const currentSection = yamlSections(merged.join("\n"), 0).find(
      (section) => section.name === sectionName,
    );
    if (currentSection === undefined) continue;
    const currentBlock = merged.slice(currentSection.start, currentSection.end).join("\n");
    const existingChild = yamlSections(currentBlock, 2).find(
      (child) => child.name === generatedChild.name,
    );
    if (existingChild === undefined) {
      merged.splice(currentSection.end, 0, ...generatedChild.block.split("\n"), "");
      continue;
    }
    if (!mergeSteps && generatedChild.name === "push") {
      merged = mergeWorkflowBranches(merged, currentSection, existingChild, generatedChild);
    }
    if (mergeSteps && generatedChild.name === "verify") {
      merged = mergeWorkflowSteps(merged, currentSection, existingChild, generatedChild);
    }
  }
  return merged;
}

type YamlBranches = {
  readonly start: number;
  readonly end: number;
  readonly indentation: string;
  readonly branches: readonly string[];
  readonly comment: string;
  readonly style: "flow" | "block";
};

function yamlBranches(content: string): YamlBranches | undefined {
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const indentationLength = line.match(/^\s*/)?.[0].length ?? 0;
    if (yamlKey(line, indentationLength) !== "branches") continue;
    const indentation = line.slice(0, indentationLength);
    const keyValue = line.slice(indentationLength);
    const separator = inlineYamlColon(keyValue);
    if (separator < 0) continue;
    const rawValue = keyValue.slice(separator + 1).trim();
    const commentStart = yamlCommentStart(rawValue);
    const value = (commentStart < 0 ? rawValue : rawValue.slice(0, commentStart)).trim();
    const comment = commentStart < 0 ? "" : ` ${rawValue.slice(commentStart).trim()}`;
    if (value.startsWith("[") && value.endsWith("]")) {
      return {
        start: index,
        end: index + 1,
        indentation,
        branches: splitInlineYamlEntries(value.slice(1, -1))
          .map((branch) => normalizeYamlScalar(branch))
          .filter((branch) => branch.length > 0),
        style: "flow",
        comment,
      };
    }
    if (value.length > 0) continue;
    const branches: string[] = [];
    let end = index + 1;
    for (; end < lines.length; end += 1) {
      const branch = /^(\s+)-\s*(.+)$/.exec(lines[end] ?? "");
      if (branch === null || (branch[1]?.length ?? 0) <= indentation.length) break;
      const normalized = normalizeYamlScalar(branch[2] ?? "");
      if (normalized.length > 0) branches.push(normalized);
    }
    return { start: index, end, indentation, branches, style: "block", comment: "" };
  }
  return undefined;
}

function normalizeYamlScalar(value: string): string {
  const trimmed = yamlValueWithoutComment(value).trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if (trimmed.length >= 2 && ((first === "'" && last === "'") || (first === '"' && last === '"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function mergeWorkflowBranches(
  lines: string[],
  onSection: YamlSection,
  existingPush: YamlSection,
  generatedPush: YamlSection,
): string[] {
  const pushStart = onSection.start + existingPush.start;
  const pushEnd = onSection.start + existingPush.end;
  const existingLines = lines.slice(pushStart, pushEnd);
  const generatedBranches = yamlBranches(generatedPush.block);
  if (generatedBranches === undefined) return lines;
  const existingBranches = yamlBranches(existingLines.join("\n"));
  if (existingBranches === undefined) {
    const indentation = " ".repeat(4);
    lines.splice(
      pushStart + 1,
      0,
      `${indentation}branches: [${generatedBranches.branches.join(", ")}]`,
    );
    return lines;
  }

  const branches = [
    ...existingBranches.branches,
    ...generatedBranches.branches.filter((branch) => !existingBranches.branches.includes(branch)),
  ];
  const mergedPush = [...existingLines];
  if (existingBranches.style === "flow") {
    mergedPush.splice(
      existingBranches.start,
      1,
      `${existingBranches.indentation}branches: [${branches.join(", ")}]${existingBranches.comment}`,
    );
  } else {
    mergedPush.splice(
      existingBranches.start,
      existingBranches.end - existingBranches.start,
      `${existingBranches.indentation}branches:`,
      ...branches.map((branch) => `${existingBranches.indentation}  - ${branch}`),
    );
  }
  lines.splice(pushStart, existingLines.length, ...mergedPush);
  return lines;
}

function mergeWorkflowSteps(
  lines: string[],
  jobsSection: YamlSection,
  existingJob: YamlSection,
  generatedJob: YamlSection,
): string[] {
  const jobStart = jobsSection.start + existingJob.start;
  const jobEnd = jobsSection.start + existingJob.end;
  let existingJobLines = lines.slice(jobStart, jobEnd);
  const generatedSteps = yamlSections(generatedJob.block, 4).find(
    (section) => section.name === "steps",
  );
  if (generatedSteps === undefined) return lines;

  let existingSteps = yamlSections(existingJobLines.join("\n"), 4).find(
    (section) => section.name === "steps",
  );
  if (existingSteps === undefined) {
    lines.splice(jobEnd, 0, ...generatedSteps.block.split("\n"), "");
    return lines;
  }

  const existingStepsLine = existingJobLines[existingSteps.start] ?? "";
  const stepsValueStart = inlineYamlColon(existingStepsLine);
  const rawStepsValue =
    stepsValueStart < 0 ? "" : existingStepsLine.slice(stepsValueStart + 1).trim();
  const stepsCommentStart = yamlCommentStart(rawStepsValue);
  const stepsValue =
    stepsCommentStart < 0 ? rawStepsValue : rawStepsValue.slice(0, stepsCommentStart).trim();
  if (stepsValue.startsWith("[") && stepsValue.endsWith("]")) {
    const indentation = existingStepsLine.match(/^\s*/)?.[0] ?? "";
    const comment =
      stepsCommentStart < 0 ? "" : ` ${rawStepsValue.slice(stepsCommentStart).trim()}`;
    const entries = splitInlineYamlEntries(stepsValue.slice(1, -1));
    lines.splice(
      jobStart + existingSteps.start,
      1,
      `${indentation}steps:${comment}`,
      ...entries.map((entry) => `${indentation}  - ${entry}`),
    );
    existingJobLines = lines.slice(jobStart, jobEnd + entries.length);
    existingSteps = yamlSections(existingJobLines.join("\n"), 4).find(
      (section) => section.name === "steps",
    );
  }
  if (existingSteps === undefined) return lines;

  const existingIdentities = new Set(
    existingJobLines
      .map((line) => yamlStepIdentity(line))
      .filter((identity) => identity !== undefined),
  );
  const generatedStepLines = generatedSteps.block.split("\n");
  const missingSteps: string[] = [];
  for (let index = 1; index < generatedStepLines.length; index += 1) {
    const line = generatedStepLines[index] ?? "";
    if (!/^\s{6}- /.test(line)) continue;
    const identity = yamlStepIdentity(line);
    if (identity !== undefined && existingIdentities.has(identity)) continue;
    const nextStep = generatedStepLines.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && /^\s{6}- /.test(candidate),
    );
    const end = nextStep < 0 ? generatedStepLines.length : nextStep;
    missingSteps.push(...generatedStepLines.slice(index, end));
    index = end - 1;
  }
  if (missingSteps.length === 0) return lines;
  const insertion = jobsSection.start + existingJob.start + existingSteps.end;
  lines.splice(insertion, 0, ...missingSteps);
  return lines;
}

function yamlStepIdentity(line: string): string | undefined {
  const value = line.trim();
  if (!value.startsWith("- ")) return undefined;
  const item = value.slice(2).trim();
  if (item.startsWith("{") && item.endsWith("}")) {
    for (const key of ["uses", "run"]) {
      const entry = inlineYamlProperty(item, key);
      if (entry !== undefined) return `${key}: ${yamlValueWithoutComment(entry).trim()}`;
    }
    return undefined;
  }
  const separator = inlineYamlColon(item);
  if (separator < 0) return undefined;
  const key = normalizeYamlScalar(item.slice(0, separator));
  if (key !== "uses" && key !== "run") return undefined;
  return `${key}: ${yamlValueWithoutComment(item.slice(separator + 1)).trim()}`;
}

function inlineYamlProperty(value: string, property: string): string | undefined {
  if (!value.startsWith("{") || !value.endsWith("}")) return undefined;
  for (const entry of splitInlineYamlEntries(value.slice(1, -1))) {
    const separator = inlineYamlColon(entry);
    if (separator < 0) continue;
    if (normalizeYamlScalar(entry.slice(0, separator)) === property) {
      return entry.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function appendYamlBlock(lines: readonly string[], block: string): string[] {
  const result = [...lines];
  while (result.at(-1) === "") result.pop();
  result.push("", ...block.split("\n"), "");
  return result;
}

type ImportBinding = { readonly local: string; readonly source: string };

function mergeImports(
  existingContent: string,
  generatedContent: string,
  artifact: string,
): { readonly content: string; readonly conflicts: readonly string[] } {
  const existingImportBindings = importLines(existingContent).flatMap((line) =>
    importBindings(line),
  );
  const existingBindings = new Map(
    existingImportBindings.map((binding) => [binding.local, binding.source] as const),
  );
  const existingSources = new Set(existingImportBindings.map((binding) => binding.source));
  const missing: string[] = [];
  const conflicts: string[] = [];
  for (const line of importLines(generatedContent)) {
    const bindings = importBindings(line);
    for (const binding of bindings) {
      const existingSource = existingBindings.get(binding.local);
      if (existingSource !== undefined && existingSource !== binding.source) {
        conflicts.push(`${artifact}:import ${binding.local}`);
      }
    }
    if (
      bindings.length === 0 ||
      !bindings.every(
        (binding) =>
          existingBindings.get(binding.local) === binding.source ||
          existingSources.has(binding.source),
      )
    ) {
      if (!existingContent.includes(line)) missing.push(line);
    }
  }
  if (conflicts.length > 0) {
    return { content: existingContent, conflicts: [...new Set(conflicts)] };
  }
  if (missing.length === 0) return { content: existingContent, conflicts: [] };
  const shebang = existingContent.startsWith("#!") ? `${existingContent.split("\n")[0]}\n` : "";
  const body = shebang.length > 0 ? existingContent.slice(shebang.length) : existingContent;
  return { content: `${shebang}${missing.join("\n")}\n${body}`, conflicts: [] };
}

function importLines(content: string): string[] {
  const lines = content.split("\n");
  const imports: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^import\s/.test(lines[index]?.trim() ?? "")) continue;
    let statement = lines[index]?.trim() ?? "";
    while (!isCompleteImport(statement) && index + 1 < lines.length) {
      index += 1;
      statement += `\n${lines[index]?.trim() ?? ""}`;
    }
    if (isCompleteImport(statement)) imports.push(statement);
  }
  return imports;
}

function isCompleteImport(statement: string): boolean {
  return (
    /\bfrom\s+["'][^"']+["']\s*;?(?:\s*\/\/.*)?\s*$/.test(statement) ||
    /^import\s+["'][^"']+["']\s*;?(?:\s*\/\/.*)?\s*$/.test(statement)
  );
}

function importBindings(line: string): readonly ImportBinding[] {
  const match = /^import\s+([\s\S]+?)\s+from\s+["']([^"']+)["']/.exec(line.trim());
  if (match === null) return [];
  const clause = match[1]?.trim() ?? "";
  const source = match[2] ?? "";
  const namedStart = clause.indexOf("{");
  if (namedStart >= 0) {
    const defaultClause = clause.slice(0, namedStart).replace(/,\s*$/, "").trim();
    const namedClause = clause.slice(namedStart + 1, clause.lastIndexOf("}"));
    const bindings: ImportBinding[] =
      defaultClause.length > 0 ? [{ local: defaultClause, source }] : [];
    return [
      ...bindings,
      ...namedClause
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const parts = entry.split(/\s+as\s+/);
          return { local: (parts[1] ?? parts[0] ?? "").trim(), source };
        }),
    ];
  }
  if (clause.startsWith("* as ")) return [{ local: clause.slice(5).trim(), source }];
  const comma = clause.indexOf(",");
  if (comma >= 0) {
    const defaultBinding = clause.slice(0, comma).trim();
    const remainder = clause.slice(comma + 1).trim();
    return [
      { local: defaultBinding, source },
      ...(remainder.startsWith("* as ") ? [{ local: remainder.slice(5).trim(), source }] : []),
    ];
  }
  return [{ local: clause, source }];
}

function resolveImportedIdentifier(
  entry: string,
  generatedContent: string,
  mergedContent: string,
): string {
  const identifier = entry.trim();
  const generatedBinding = importLines(generatedContent)
    .flatMap((line) => importBindings(line))
    .find((binding) => binding.local === identifier);
  if (generatedBinding === undefined) return entry;
  const mergedBinding = importLines(mergedContent)
    .flatMap((line) => importBindings(line))
    .find((binding) => binding.source === generatedBinding.source);
  return mergedBinding?.local ?? entry;
}

function arrayEntries(content: string, property: string): string[] {
  const match = new RegExp(`${escapeRegExp(property)}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(content);
  if (match === null) return [];
  return arrayValueEntries(`[${match[1] ?? ""}]`);
}

function mergeArrayProperty(
  content: string,
  property: string,
  generatedEntries: readonly string[],
  objectOpen: number,
  conflictPath: string,
): { readonly content: string; readonly conflicts: readonly string[] } {
  if (objectOpen < 0) return { content, conflicts: [] };
  const existingProperty = topLevelProperty(content, objectOpen, property);
  if (existingProperty === undefined) {
    return {
      content: insertPropertyAt(
        content,
        objectOpen,
        `${property}: [${generatedEntries.join(", ")}]`,
      ),
      conflicts: [],
    };
  }

  const existingValue = existingProperty.value.trim();
  if (!existingValue.startsWith("[") || !existingValue.endsWith("]")) {
    return { content, conflicts: [conflictPath] };
  }

  const existingEntries = arrayValueEntries(existingValue);
  const seen = new Set(existingEntries.map(normalizeArrayEntry));
  const additions: string[] = [];
  for (const entry of generatedEntries) {
    const normalized = normalizeArrayEntry(entry);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    additions.push(entry);
  }
  if (additions.length === 0) return { content, conflicts: [] };
  const mergedValue = hasArrayComment(existingValue)
    ? appendArrayEntriesPreservingComments(existingValue, additions)
    : `[${[...existingEntries, ...additions].join(", ")}]`;
  return {
    content:
      content.slice(0, existingProperty.start) +
      `${property}: ${mergedValue}` +
      content.slice(existingProperty.end),
    conflicts: [],
  };
}

type PropertyLocation = {
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
  readonly value: string;
};

function topLevelProperty(
  content: string,
  objectOpen: number,
  property: string,
): PropertyLocation | undefined {
  if (objectOpen < 0) return undefined;
  const objectClose = matchingDelimiter(content, objectOpen, "{", "}");
  if (objectClose < 0) return undefined;

  let cursor = objectOpen + 1;
  while (cursor < objectClose) {
    while (cursor < objectClose && /\s|,/.test(content[cursor] ?? "")) cursor += 1;
    if (content.startsWith("//", cursor)) {
      const lineEnd = content.indexOf("\n", cursor + 2);
      cursor = lineEnd < 0 ? objectClose : lineEnd + 1;
      continue;
    }
    if (content.startsWith("/*", cursor)) {
      const commentEnd = content.indexOf("*/", cursor + 2);
      cursor = commentEnd < 0 ? objectClose : commentEnd + 2;
      continue;
    }
    const keyMatch = /^(?:(['"])(.*?)\1|([A-Za-z_$][\w$]*))\s*:/.exec(content.slice(cursor));
    if (keyMatch === null) {
      cursor += 1;
      continue;
    }
    const key = keyMatch[2] ?? keyMatch[3] ?? "";
    const valueStart = cursor + keyMatch[0].length;
    const valueEnd = expressionEnd(content, valueStart, objectClose);
    if (key === property) {
      return {
        start: cursor,
        end: valueEnd,
        valueStart,
        value: content.slice(valueStart, valueEnd),
      };
    }
    cursor = valueEnd < objectClose ? valueEnd + 1 : objectClose;
  }
  return undefined;
}

function expressionEnd(content: string, start: number, limit: number): number {
  let curlyDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let sawDelimiter = false;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < limit; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      if (curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) return index;
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      if (curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) return index;
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "{") {
      curlyDepth += 1;
      sawDelimiter = true;
    }
    if (character === "}") curlyDepth -= 1;
    if (character === "[") {
      bracketDepth += 1;
      sawDelimiter = true;
    }
    if (character === "]") bracketDepth -= 1;
    if (character === "(") {
      parenDepth += 1;
      sawDelimiter = true;
    }
    if (character === ")") parenDepth -= 1;
    if (sawDelimiter && curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return index + 1;
    }
    if (character === "," && curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return index;
    }
  }
  return limit;
}

function arrayValueEntries(value: string): string[] {
  const body = removeArrayComments(value.trim().slice(1, -1));
  const entries: string[] = [];
  let start = 0;
  let curlyDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") curlyDepth += 1;
    if (character === "}") curlyDepth -= 1;
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth -= 1;
    if (character === "(") parenDepth += 1;
    if (character === ")") parenDepth -= 1;
    if (character === "," && curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const entry = body.slice(start, index).trim();
      if (entry.length > 0) entries.push(entry);
      start = index + 1;
    }
  }

  const lastEntry = body.slice(start).trim();
  if (lastEntry.length > 0) entries.push(lastEntry);
  return entries;
}

function removeArrayComments(body: string): string {
  let result = "";
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const nextCharacter = body[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += character;
      } else {
        result += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote.length > 0) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

function hasArrayComment(value: string): boolean {
  return arrayCommentStart(value.trim().slice(1, -1)) >= 0;
}

function appendArrayEntriesPreservingComments(value: string, additions: readonly string[]): string {
  const body = value.trim().slice(1, -1);
  const commentStart = arrayCommentStart(body);
  if (commentStart < 0) return `[${additions.join(", ")}]`;
  const prefix = body.slice(0, commentStart).trimEnd();
  const comment = body.slice(commentStart).trim();
  const separator = prefix.length === 0 || prefix.endsWith(",") ? "" : ",";
  return `[${prefix}${separator}\n${additions.join(",\n")}\n${comment}\n]`;
}

function arrayCommentStart(body: string): number {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const nextCharacter = body[index + 1];
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (
      (character === "/" && nextCharacter === "/") ||
      (character === "/" && nextCharacter === "*")
    ) {
      return index;
    }
  }
  return -1;
}

function normalizeArrayEntry(entry: string): string {
  const trimmed = entry.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if (trimmed.length >= 2 && ((first === "'" && last === "'") || (first === '"' && last === '"'))) {
    return trimmed.slice(1, -1).replace(/\\([\\'"`])/g, "$1");
  }
  return trimmed;
}

function mergePlugins(
  content: string,
  generatedPlugins: readonly { readonly name: string; readonly specifier: string }[],
): Reconciliation {
  const existingProperty = topLevelProperty(content, configObjectOpen(content), "jsPlugins");
  if (existingProperty === undefined) {
    const properties = ["jsPlugins: ["];
    for (const plugin of generatedPlugins) {
      properties.push(
        "  {",
        `    name: ${JSON.stringify(plugin.name)},`,
        `    specifier: ${JSON.stringify(plugin.specifier)},`,
        "  },",
      );
    }
    properties.push("]");
    return reconciled(insertConfigProperty(content, properties.join("\n")));
  }

  const existingValue = existingProperty.value.trim();
  if (!existingValue.startsWith("[") || !existingValue.endsWith("]")) {
    return { content, changed: false, conflicts: [] };
  }

  const existingPlugins = pluginEntries(existingValue);
  const conflicts = generatedPlugins
    .map((plugin) => {
      const existing = existingPlugins.find(({ name }) => name === plugin.name);
      if (existing === undefined || existing.specifier === plugin.specifier) return undefined;
      return `oxlint.config.ts.jsPlugins.${plugin.name}.specifier`;
    })
    .filter((conflict): conflict is string => conflict !== undefined);
  if (conflicts.length > 0) return { content, changed: false, conflicts };

  const existingNames = existingPlugins.map(({ name }) => name);
  const missing = generatedPlugins.filter((plugin) => !existingNames.includes(plugin.name));
  if (missing.length === 0) return { content, changed: false, conflicts: [] };

  const existingEntries = arrayValueEntries(existingValue);
  const additions = missing.map(
    (plugin) =>
      `{ name: ${JSON.stringify(plugin.name)}, specifier: ${JSON.stringify(plugin.specifier)} }`,
  );
  const mergedValue = hasArrayComment(existingValue)
    ? appendArrayEntriesPreservingComments(existingValue, additions)
    : `[${[...existingEntries, ...additions].join(", ")}]`;
  return reconciled(
    content.slice(0, existingProperty.start) +
      `jsPlugins: ${mergedValue}` +
      content.slice(existingProperty.end),
  );
}

function pluginEntries(content: string): { readonly name: string; readonly specifier: string }[] {
  const trimmed = content.trim();
  const array = trimmed.startsWith("[")
    ? trimmed
    : topLevelProperty(content, configObjectOpen(content), "jsPlugins")?.value.trim();
  if (array === undefined || !array.startsWith("[") || !array.endsWith("]")) return [];

  const plugins: { name: string; specifier: string }[] = [];
  for (const entry of arrayValueEntries(array)) {
    const name = /\bname\s*:\s*(["'])([^"']+)\1/.exec(entry)?.[2];
    const specifier = /\bspecifier\s*:\s*(["'])([^"']+)\1/.exec(entry)?.[2];
    if (name !== undefined && specifier !== undefined) plugins.push({ name, specifier });
  }
  return plugins;
}

function propertyLine(content: string, property: string): string | undefined {
  return content
    .split("\n")
    .find((line) => new RegExp(`^\\s*${escapeRegExp(property)}\\s*:`).test(line));
}

function hasProperty(content: string, property: string): boolean {
  return topLevelProperty(content, configObjectOpen(content), property) !== undefined;
}

function hasConfigObject(content: string): boolean {
  return configObjectOpen(content) >= 0;
}

function configObjectOpen(content: string): number {
  const defineConfig = codeIndexOf(content, "defineConfig({");
  if (defineConfig >= 0) return defineConfig + "defineConfig(".length;

  const defaultObject = codeIndexOf(content, "export default {");
  if (defaultObject >= 0) return defaultObject + "export default ".length;
  return -1;
}

type DefaultExportExpression = {
  readonly start: number;
  readonly end: number;
  readonly expression: string;
};

function defaultExportExpression(content: string): DefaultExportExpression | undefined {
  const exportIndex = codeIndexOf(content, "export default");
  if (exportIndex < 0) return undefined;
  const exportMatch = /^export\s+default\s+/.exec(content.slice(exportIndex));
  if (exportMatch === null) return undefined;
  const expressionStart = exportIndex + exportMatch[0].length;
  let cursor = expressionStart;
  while (/\s/.test(content[cursor] ?? "")) cursor += 1;

  const firstCharacter = content[cursor];
  if (firstCharacter === "[" || firstCharacter === "{") {
    const close = matchingDelimiter(
      content,
      cursor,
      firstCharacter,
      firstCharacter === "[" ? "]" : "}",
    );
    if (close < 0) return undefined;
    const end = content[close + 1] === ";" ? close + 2 : close + 1;
    return {
      start: exportIndex,
      end,
      expression: content.slice(cursor, close + 1),
    };
  }

  const expressionEnd = defaultExportStatementEnd(content, cursor);
  return {
    start: exportIndex,
    end: content[expressionEnd] === ";" ? expressionEnd + 1 : expressionEnd,
    expression: content.slice(cursor, expressionEnd).trim(),
  };
}

function defaultExportStatementEnd(content: string, start: number): number {
  let curlyDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") blockComment = false;
      continue;
    }
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      if (curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) return index;
      lineComment = true;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      if (curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) return index;
      blockComment = true;
      continue;
    }
    if (character === "{") curlyDepth += 1;
    if (character === "}") curlyDepth -= 1;
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth -= 1;
    if (character === "(") parenDepth += 1;
    if (character === ")") parenDepth -= 1;
    if (curlyDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      if (character === ";" || character === "\n") return index;
    }
  }
  return content.length;
}

function insertConfigProperty(content: string, property: string): string {
  const objectOpen = configObjectOpen(content);
  if (objectOpen >= 0) return insertPropertyAt(content, objectOpen, property);
  return content;
}

function insertPropertyAt(content: string, openBrace: number, property: string): string {
  const closeBrace = matchingDelimiter(content, openBrace, "{", "}");
  if (closeBrace < 0) return content;
  const body = content.slice(openBrace + 1, closeBrace);
  const trimmedBody = body.trimEnd();
  const safeBody = moveTrailingComment(trimmedBody);
  const closeLineStart = content.lastIndexOf("\n", closeBrace) + 1;
  const closeIndent = content.slice(closeLineStart, closeBrace).match(/^\s*/)?.[0] ?? "";
  const propertyIndent = `${closeIndent}  `;
  const normalizedProperty = property
    .split("\n")
    .map((line) => `${propertyIndent}${line.trim()}`)
    .join("\n");
  const trailingLine = safeBody.slice(safeBody.lastIndexOf("\n") + 1);
  const separator =
    safeBody.length === 0 || safeBody.endsWith(",") || arrayCommentStart(trailingLine) >= 0
      ? ""
      : ",";
  const prefix = content.slice(0, openBrace + 1) + safeBody + separator + "\n";
  return `${prefix}${normalizedProperty}\n${closeIndent}${content.slice(closeBrace)}`;
}

function moveTrailingComment(body: string): string {
  const lineStart = body.lastIndexOf("\n") + 1;
  const line = body.slice(lineStart);
  const commentOffset = arrayCommentStart(line);
  if (commentOffset < 0) return body;
  const commentStart = lineStart + commentOffset;
  const code = body.slice(0, commentStart).trimEnd();
  const indentation = line.match(/^\s*/)?.[0] ?? "";
  const separator = code.length === 0 || code.endsWith(",") ? "" : ",";
  return `${code}${separator}\n${indentation}${body.slice(commentStart).trimStart()}`;
}

function propertyObjectOpen(content: string, property: string): number | undefined {
  const propertyLocation = topLevelProperty(content, configObjectOpen(content), property);
  if (propertyLocation === undefined) return undefined;
  let valueStart = propertyLocation.valueStart;
  while (/\s/.test(content[valueStart] ?? "")) valueStart += 1;
  return content[valueStart] === "{" ? valueStart : undefined;
}

function matchingDelimiter(
  content: string,
  open: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") blockComment = false;
      continue;
    }
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      continue;
    }
    if (character === openChar) depth += 1;
    if (character === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function uniqueJsonValues(values: readonly JsonValue[]): JsonValue[] {
  const result: JsonValue[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const serialized = JSON.stringify(value);
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    result.push(value);
  }
  return result;
}

function asJsonArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function codeIndexOf(content: string, needle: string): number {
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const nextCharacter = content[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote.length > 0) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (content.startsWith(needle, index)) return index;
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
