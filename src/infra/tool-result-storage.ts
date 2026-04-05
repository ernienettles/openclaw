/**
 * Tool result disk persistence — Claude Code pattern.
 *
 * When a tool result exceeds MAX_SIZE_BYTES, the full content is written to
 * disk and a preview (first PREVIEW_BYTES) is returned instead. This prevents
 * the model context from being bloated by large tool output while keeping
 * the full result accessible.
 *
 * Reference: claude-code/src/utils/toolResultStorage.ts
 */

import * as fs from "fs/promises";
import * as path from "path";

/** Max size before persisting to disk (30 KB). */
export const MAX_TOOL_RESULT_BYTES = 30 * 1024;

/** How many bytes to show as the preview (2 KB). */
export const TOOL_RESULT_PREVIEW_BYTES = 2000;

/** Directory under the workspace where large results are stored. */
export const TOOL_RESULTS_DIR = ".openclaw/tool-results";

export function getToolResultsDir(workspace: string): string {
  return path.join(workspace, TOOL_RESULTS_DIR);
}

export function getToolResultPath(workspace: string, toolUseId: string): string {
  return path.join(getToolResultsDir(workspace), `${toolUseId}.txt`);
}

/**
 * Check if content exceeds the threshold that requires disk persistence.
 */
export function requiresDiskPersistence(content: string): boolean {
  return content.length > MAX_TOOL_RESULT_BYTES;
}

/**
 * Persist content to disk and return a preview + path info.
 */
export async function persistToolResult(
  workspace: string,
  toolUseId: string,
  content: string,
): Promise<{ path: string; size: number; preview: string }> {
  const dir = getToolResultsDir(workspace);
  await fs.mkdir(dir, { recursive: true });
  const fp = getToolResultPath(workspace, toolUseId);
  await fs.writeFile(fp, content, "utf-8");
  const preview = generatePreview(content);
  return { path: fp, size: content.length, preview };
}

/**
 * Generate a preview from raw content — shows first PREVIEW_BYTES + truncation notice.
 */
export function generatePreview(content: string): string {
  if (content.length <= TOOL_RESULT_PREVIEW_BYTES) {
    return content;
  }
  return (
    content.slice(0, TOOL_RESULT_PREVIEW_BYTES) +
    `\n[... ${content.length - TOOL_RESULT_PREVIEW_BYTES} more bytes — full result at path above ...]`
  );
}
