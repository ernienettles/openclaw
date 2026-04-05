/**
 * Sed safety: detect and safely apply sed in-place edits.
 *
 * Claude Code pattern: instead of running `sed -i`, the edit is applied in Node.js
 * so the preview (computed result) exactly matches what gets written.
 *
 * This module provides:
 * 1. Detection of sed in-place commands
 * 2. Parsing of common sed substitution patterns
 * 3. Application of the substitution to file content in-memory
 *
 * Reference: claude-code/src/tools/BashTool/sedEditParser.ts
 */

import * as fs from "fs/promises";
import * as path from "path";

export type SedSubstitution = {
  filePath: string;
  pattern: string;      // regex string
  replacement: string;
  flags: string;        // "g", "gi", etc.
  lineNumber?: number;   // if /Nd syntax used
};

/**
 * Detect whether a command contains a sed in-place edit.
 * Matches: sed -i 's/find/replace/g' file, sed --in-place=suffix ...
 */
export function isSedInPlaceCommand(command: string): boolean {
  return /sed\s+(-i|--in-place)\b/i.test(command);
}

/**
 * Parse a sed substitution expression like s/foo/bar/g or s/foo/bar/gi
 * Returns null if the pattern cannot be parsed.
 */
export function parseSedSubstitution(expr: string): { pattern: string; replacement: string; flags: string } | null {
  // Standard: s/pattern/replacement/flags
  const standardMatch = expr.match(/^s(.)[\s\S]*?\1([gimsuvy]*)$/);
  if (standardMatch) {
    return {
      pattern: escapeToRegex(standardMatch[1]!),
      replacement: standardMatch[2]!,
      flags: standardMatch[3]!,
    };
  }
  return null;
}

/**
 * Convert a glob-like sed pattern to a JavaScript regex string.
 * Handles: . * [...] [^...] + ? {n,m}
 */
function escapeToRegex(pattern: string): string {
  // If already contains regex metacharacters, use as-is
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // escape special regex chars
    .replace(/\*/g, ".*")                    // * → .*
    .replace(/\?/g, ".");                     // ? → .
}

/**
 * Apply a sed substitution to a string, returning the modified string.
 * Returns null if the substitution could not be applied.
 */
export function applySedSubstitution(
  content: string,
  substitution: { pattern: string; replacement: string; flags: string },
): string | null {
  try {
    const regex = new RegExp(substitution.pattern, substitution.flags);
    return content.replace(regex, substitution.replacement);
  } catch {
    return null;
  }
}

/**
 * Attempt to parse and safely apply a sed -i command to a file.
 * Returns a preview of the result, or an error message if parsing failed.
 *
 * If the command cannot be parsed, returns { safe: false } so the
 * caller can decide whether to warn or fall through to the real sed.
 */
export async function previewSedInPlace(
  command: string,
): Promise<
  | { safe: true; filePath: string; preview: string; error?: undefined }
  | { safe: false; reason: string }
> {
  // Extract the sed expression and file path from the command
  // Supports: sed -i 's/a/b/g' file, sed -i "s/a/b/g" file, sed -i --in-place file
  const match = command.match(
    /sed\s+(?:--in-place|-i(?:\S+)?)\s+['"](.+?)['"]\s+(\S+)/,
  );
  if (!match) {
    // Fall through to regular sed (not our simple substitution pattern)
    return { safe: false, reason: "Could not parse sed command" };
  }

  const [, expr, filePath] = match;
  const parsed = parseSedSubstitution(expr);
  if (!parsed) {
    return { safe: false, reason: "Substitution pattern not supported" };
  }

  // Resolve the file path
  const resolvedPath = path.resolve(filePath);

  // Read the file
  let originalContent: string;
  try {
    originalContent = await fs.readFile(resolvedPath, "utf-8");
  } catch (e) {
    return { safe: false, reason: `Could not read file: ${(e as Error).message}` };
  }

  // Apply substitution
  const result = applySedSubstitution(originalContent, parsed);
  if (result === null) {
    return { safe: false, reason: "Invalid regex pattern" };
  }

  return {
    safe: true,
    filePath: resolvedPath,
    preview: result,
  };
}
