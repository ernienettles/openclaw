/** Commands that only read data — safe for read-only execution */
export const BASH_READ_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "wc",
  "jq",
  "awk",
  "sed",
  "cut",
  "sort",
  "uniq",
  "tr",
  "column",
  "expand",
  "fold",
  "hexdump",
  "od",
  "base64",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "cmp",
  "diff",
  "comm",
  "join",
  "paste",
  "split",
  "csplit",
  "find",
  "locate",
  "xargs",
  "which",
  "type",
  "command",
  "builtin",
  "printf",
  "echo",
  "yes",
  "seq",
  "factor",
  "groups",
  "id",
  "logname",
  "whoami",
  "pwd",
  "date",
  "arch",
  "uname",
  "uptime",
  "hostname",
  "env",
  "printenv",
  "test",
  "[",
  "sleep",
  "timeout",
]);

/** Commands that list/discover files — also read-only */
export const BASH_LIST_COMMANDS = new Set([
  "ls",
  "la",
  "ll",
  "dir",
  "vdir",
  "tree",
  "du",
  "df",
  "stat",
  "file",
  "readlink",
  "realpath",
  "path",
  "dirname",
  "basename",
  "mktemp",
  "mkfifo",
]);

/** Commands that modify state silently — output suppressed on success */
export const BASH_SILENT_COMMANDS = new Set([
  "mv",
  "cp",
  "rm",
  "rmdir",
  "mkdir",
  "chmod",
  "chown",
  "chgrp",
  "touch",
  "ln",
  "link",
  "unlink",
  "mkfs",
  "mkswap",
  "dd",
  "sync",
  "truncate",
  "fallocate",
  "chattr",
  "setfacl",
]);

/**
 * Classify a command pipeline as read-only or write-capable.
 * Returns "read" if all segments are read/list commands.
 * Returns "write" if any write operation is detected.
 * Returns "unknown" if classification cannot be determined.
 */
export function classifyCommandPipeline(command: string): "read" | "write" | "unknown" {
  const segments = command.split("|").map((s) => s.trim());
  const allRead = segments.every((seg) => {
    const firstToken = seg.split(/\s+/)[0]?.toLowerCase()?.replace(/^-/, "") ?? "";
    return BASH_READ_COMMANDS.has(firstToken) || BASH_LIST_COMMANDS.has(firstToken);
  });
  if (allRead) {
    return "read";
  }

  const writeIndicators =
    /\b(mv|cp|rm|mkdir|chmod|chown|dd|ln\s+-s|touch|tee|git\s+push|npm\s+install|yarn\s+add|pip\s+install)\b/i;
  if (writeIndicators.test(command)) {
    return "write";
  }

  return "unknown";
}

export type SafeBinSemanticValidationParams = {
  binName?: string;
  positional: readonly string[];
};

type SafeBinSemanticRule = {
  validate?: (params: SafeBinSemanticValidationParams) => boolean;
  configWarning?: string;
};

const JQ_ENV_FILTER_PATTERN = /(^|[^.$A-Za-z0-9_])env([^A-Za-z0-9_]|$)/;
const JQ_ENV_VARIABLE_PATTERN = /\$ENV\b/;
const ALWAYS_DENY_SAFE_BIN_SEMANTICS = () => false;

const UNSAFE_SAFE_BIN_WARNINGS = {
  awk: "awk-family interpreters can execute commands, access ENVIRON, and write files, so prefer explicit allowlist entries or approval-gated runs instead of safeBins.",
  jq: "jq supports broad jq programs and builtins (for example `env`), so prefer explicit allowlist entries or approval-gated runs instead of safeBins.",
  sed: "sed scripts can execute commands and write files, so prefer explicit allowlist entries or approval-gated runs instead of safeBins.",
} as const;

const SAFE_BIN_SEMANTIC_RULES: Readonly<Record<string, SafeBinSemanticRule>> = {
  jq: {
    validate: ({ positional }) =>
      !positional.some(
        (token) => JQ_ENV_FILTER_PATTERN.test(token) || JQ_ENV_VARIABLE_PATTERN.test(token),
      ),
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.jq,
  },
  awk: {
    validate: ALWAYS_DENY_SAFE_BIN_SEMANTICS,
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.awk,
  },
  gawk: {
    validate: ALWAYS_DENY_SAFE_BIN_SEMANTICS,
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.awk,
  },
  mawk: {
    validate: ALWAYS_DENY_SAFE_BIN_SEMANTICS,
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.awk,
  },
  nawk: {
    validate: ALWAYS_DENY_SAFE_BIN_SEMANTICS,
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.awk,
  },
  sed: {
    validate: ALWAYS_DENY_SAFE_BIN_SEMANTICS,
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.sed,
  },
  gsed: {
    validate: ALWAYS_DENY_SAFE_BIN_SEMANTICS,
    configWarning: UNSAFE_SAFE_BIN_WARNINGS.sed,
  },
};

export function normalizeSafeBinName(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const tail = trimmed.split(/[\\/]/).at(-1);
  const normalized = tail ?? trimmed;
  return normalized.replace(/\.(?:exe|cmd|bat|com)$/i, "");
}

export function getSafeBinSemanticRule(binName?: string): SafeBinSemanticRule | undefined {
  const normalized = typeof binName === "string" ? normalizeSafeBinName(binName) : "";
  return normalized ? SAFE_BIN_SEMANTIC_RULES[normalized] : undefined;
}

export function validateSafeBinSemantics(params: SafeBinSemanticValidationParams): boolean {
  return getSafeBinSemanticRule(params.binName)?.validate?.(params) ?? true;
}

export function listRiskyConfiguredSafeBins(entries: Iterable<string>): Array<{
  bin: string;
  warning: string;
}> {
  const hits = new Map<string, string>();
  for (const entry of entries) {
    const normalized = normalizeSafeBinName(entry);
    if (!normalized || hits.has(normalized)) {
      continue;
    }
    const warning = getSafeBinSemanticRule(normalized)?.configWarning;
    if (!warning) {
      continue;
    }
    hits.set(normalized, warning);
  }
  return Array.from(hits.entries())
    .map(([bin, warning]) => ({ bin, warning }))
    .toSorted((a, b) => a.bin.localeCompare(b.bin));
}
