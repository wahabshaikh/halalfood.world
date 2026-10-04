import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DATABASE_NAME = "halalfood-world";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const WRANGLER_BINARY = process.platform === "win32" ? "wrangler.cmd" : "wrangler";

/**
 * Split SQL on semicolons that end a statement.
 *
 * Semicolons inside quotes and inside `--` or block comments are not
 * delimiters. Leading comments are removed so a statement cannot start with
 * `--`, which `wrangler d1 execute --command` would parse as a flag.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;

  const push = (end: number) => {
    const statement = stripLeadingComments(sql.slice(start, end)).trim();
    if (statement) statements.push(statement);
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "-" && sql[index + 1] === "-") {
      const lineEnd = sql.indexOf("\n", index);
      index = lineEnd === -1 ? sql.length : lineEnd;
      continue;
    }
    if (character === "/" && sql[index + 1] === "*") {
      const commentEnd = sql.indexOf("*/", index + 2);
      index = commentEnd === -1 ? sql.length : commentEnd + 1;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      push(index);
      start = index + 1;
    }
  }

  push(sql.length);
  return statements;
}

function stripLeadingComments(statement: string): string {
  let remaining = statement.trim();
  while (remaining) {
    if (remaining.startsWith("--")) {
      const lineEnd = remaining.indexOf("\n");
      remaining = lineEnd === -1 ? "" : remaining.slice(lineEnd + 1).trim();
      continue;
    }
    if (remaining.startsWith("/*")) {
      const commentEnd = remaining.indexOf("*/", 2);
      remaining = commentEnd === -1 ? "" : remaining.slice(commentEnd + 2).trim();
      continue;
    }
    break;
  }
  return remaining;
}

type AddColumnStatement = {
  column: string;
};

function addColumnStatement(statement: string): AddColumnStatement | null {
  const target = addColumnTarget(statement);
  if (!target || target.table.toLowerCase() !== "places") return null;
  return { column: target.column };
}

export type ColumnTarget = { table: string; column: string };

/** Any ALTER TABLE ... ADD COLUMN, not only places. */
export function addColumnTarget(statement: string): ColumnTarget | null {
  const withoutComments = stripLeadingComments(statement);
  const match = withoutComments.match(
    /^ALTER\s+TABLE\s+(?:"([^"]+)"|`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))\s+ADD\s+COLUMN\s+(?:"((?:[^"]|"")+)"|`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))(?=\s|$)/i,
  );
  if (!match) return null;
  return {
    table: (match[1] ?? match[2] ?? match[3]).replace(/""/g, '"'),
    column: (match[4] ?? match[5] ?? match[6]).replace(/""/g, '"'),
  };
}

/**
 * Drop ADD COLUMN statements whose column is already on that table.
 * Other statements, including ADD COLUMN for an unknown table, stay.
 */
export function withoutExistingColumns(
  statements: readonly string[],
  columnsByTable: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  return statements.filter((statement) => {
    const target = addColumnTarget(statement);
    if (!target) return true;
    const columns = columnsByTable.get(target.table.toLowerCase());
    if (!columns) return true;
    return !columns.has(target.column.toLowerCase());
  });
}

function placesTableName(value: string): boolean {
  const normalized = value.replace(/^['"`]|['"`]$/g, "").toLowerCase();
  return (
    normalized === "places" ||
    /^(?:new_|old_|backup_|tmp_|temp_|rebuilt_)?places(?:_|$)/.test(normalized) ||
    /^(?:new|old|backup|tmp|temp|rebuilt)_places$/.test(normalized)
  );
}

function assertSafeStatement(statement: string): void {
  const withoutComments = stripLeadingComments(statement);
  if (/\bDROP\s+TABLE\b/i.test(withoutComments)) {
    throw new Error("Unsafe migration: DROP TABLE is forbidden");
  }

  const renamePlaces =
    /^ALTER\s+TABLE\s+(?:"places"|places)\b[\s\S]*\bRENAME\s+TO\b/i.test(
      withoutComments,
    );
  const dropColumnFromPlaces =
    /^ALTER\s+TABLE\s+(?:"places"|places)\b[\s\S]*\bDROP\s+COLUMN\b/i.test(
      withoutComments,
    );
  if (renamePlaces || dropColumnFromPlaces) {
    throw new Error("Unsafe migration: rebuilding places is forbidden");
  }

  const createTable = withoutComments.match(
    /^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|([A-Za-z_][A-Za-z0-9_$]*))/i,
  );
  const targetTable = createTable?.[1] ?? createTable?.[2] ?? createTable?.[3];
  if (targetTable && placesTableName(targetTable)) {
    throw new Error("Unsafe migration: rebuilding places is forbidden");
  }

  if (
    /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b[\s\S]*\bAS\s+SELECT\b[\s\S]*\bFROM\s+(?:"places"|places)\b/i.test(
      withoutComments,
    )
  ) {
    throw new Error("Unsafe migration: rebuilding places is forbidden");
  }
}

/**
 * Plan one migration after removing only duplicate ADD COLUMN statements for
 * columns already present in places. The input and output contain no secrets.
 */
export function planStatements(
  sql: string,
  existingColumns: readonly string[],
): string[] {
  const existing = new Set(existingColumns.map((column) => column.toLowerCase()));
  return splitSqlStatements(sql).filter((statement) => {
    assertSafeStatement(statement);
    const addColumn = addColumnStatement(statement);
    if (!addColumn) return true;
    return !existing.has(addColumn.column.toLowerCase());
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

/**
 * Apply pending files with wrangler's own migration runner.
 *
 * The previous statement-at-a-time runner passed each chunk to
 * `wrangler d1 execute --command`. A file that starts with a `--` comment was
 * parsed as a CLI flag (0013), and a semicolon inside a later comment split
 * the file (0015). `wrangler d1 migrations apply` sends each file to D1 as one
 * script, which is what already applies cleanly. Recorded files, including
 * 0008, are skipped.
 */
export function runRemoteMigrations(): void {
  const result = spawnSync(
    WRANGLER_BINARY,
    ["d1", "migrations", "apply", DATABASE_NAME, "--remote"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `wrangler d1 migrations apply failed${result.status === null ? " to start" : ` (exit ${result.status})`}`,
    );
  }
}

if (isMainModule()) {
  try {
    runRemoteMigrations();
  } catch (error: unknown) {
    console.error(
      error instanceof Error ? error.message : "Remote D1 migration failed",
    );
    process.exitCode = 1;
  }
}
