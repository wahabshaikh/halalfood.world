import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DATABASE_NAME = "halalfood-world";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "migrations");
const WRANGLER_BINARY = process.platform === "win32" ? "wrangler.cmd" : "wrangler";

type SqlRow = Record<string, unknown>;

function record(value: unknown): SqlRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SqlRow)
    : null;
}

/** Split SQL without treating a semicolon inside a quoted value/identifier as a delimiter. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;

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

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
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
  const withoutComments = stripLeadingComments(statement);
  const match = withoutComments.match(
    /^ALTER\s+TABLE\s+(?:"places"|places)\s+ADD\s+COLUMN\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))(?=\s|$)/i,
  );
  if (!match) return null;
  return { column: (match[1] ?? match[2]).replace(/""/g, '"') };
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

function executeWrangler(sql: string, json = false): string {
  const args = [
    "d1",
    "execute",
    DATABASE_NAME,
    "--remote",
    ...(json ? ["--json"] : []),
    "--command",
    sql,
  ];
  const result = spawnSync(WRANGLER_BINARY, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `wrangler d1 execute failed${result.status === null ? " to start" : ` (exit ${result.status})`}`,
    );
  }
  return result.stdout ?? "";
}

function parseJsonOutput(output: string): unknown {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error("wrangler d1 execute returned invalid JSON");
  }
}

function rowsFromJsonOutput(output: string): SqlRow[] {
  const payload = parseJsonOutput(output);
  const rows: SqlRow[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const item = record(value);
    if (!item) return;
    if (Array.isArray(item.results)) {
      for (const row of item.results) {
        const parsedRow = record(row);
        if (parsedRow) rows.push(parsedRow);
      }
      return;
    }
    if (Array.isArray(item.result)) {
      for (const row of item.result) {
        const parsedRow = record(row);
        if (parsedRow) rows.push(parsedRow);
      }
      return;
    }
    if ("name" in item || "cid" in item || "sql" in item) rows.push(item);
  };
  visit(payload);
  return rows;
}

function readAppliedMigrationNames(): Set<string> {
  const rows = rowsFromJsonOutput(
    executeWrangler("SELECT name FROM d1_migrations ORDER BY name", true),
  );
  return new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name : null))
      .filter((name): name is string => Boolean(name)),
  );
}

function readPlacesColumns(): Set<string> {
  const rows = rowsFromJsonOutput(executeWrangler("PRAGMA table_info('places')", true));
  return new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name.toLowerCase() : null))
      .filter((name): name is string => Boolean(name)),
  );
}

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function migrationInsert(name: string): string {
  const escapedName = name.replace(/'/g, "''");
  return `INSERT INTO d1_migrations (name) VALUES ('${escapedName}')`;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

export async function runRemoteMigrations(): Promise<void> {
  const applied = readAppliedMigrationNames();
  const existingColumns = readPlacesColumns();

  for (const name of await migrationFiles()) {
    if (applied.has(name)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
    const planned = planStatements(sql, [...existingColumns]);
    console.log(`Applying migration ${name}`);
    if (planned.length) {
      executeWrangler(planned.join(";\n"));
      for (const statement of planned) {
        const addColumn = addColumnStatement(statement);
        if (addColumn) existingColumns.add(addColumn.column.toLowerCase());
      }
    }
    executeWrangler(migrationInsert(name));
    console.log(`Recorded migration ${name}`);
  }
}

if (isMainModule()) {
  runRemoteMigrations().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Remote D1 migration failed",
    );
    process.exitCode = 1;
  });
}
