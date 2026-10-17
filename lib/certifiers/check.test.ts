import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";
import { flightPages } from "@/lib/testing/certifier-pages";
import type { R2BucketLike } from "@/lib/r2";
import type { BpjphRawRow } from "./bpjph";
import { CHECK_USER_AGENT, PAGE_DELAY_MS, runBpjphCheck, runCertifierChecks, type CheckDeps } from "./check";
import { getCertifierBySlug, listPendingChanges, listPublishedChanges, reviewChange } from "./repository";

const seed = JSON.parse(readFileSync(join(import.meta.dirname, "../../seed/certifiers/bpjph-lhln-2026-10-17.json"), "utf8")) as BpjphRawRow[];
const NOW = Date.UTC(2026, 9, 18, 2, 0, 0);
const ANIC = "439C0F0A-A1F2-40CA-AC6D-251D0BE94549";

function world(rows: BpjphRawRow[], options: { status?: (page: number, attempt: number) => number } = {}) {
  const { sqlite, db } = createTestDatabase();
  const pages = flightPages(rows);
  const requests: { url: string; userAgent: string | null }[] = [];
  const attempts = new Map<number, number>();
  const sleeps: number[] = [];
  const stored = new Map<string, string>();
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const page = Number(new URL(url).searchParams.get("page") ?? "1");
    const attempt = (attempts.get(page) ?? 0) + 1;
    attempts.set(page, attempt);
    requests.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    const status = options.status?.(page, attempt) ?? 200;
    if (status === 0) throw new TypeError("network down");
    return new Response(status === 200 ? (pages.get(page) ?? "<html></html>") : "busy", { status });
  }) as typeof fetch;
  const bucket: R2BucketLike = {
    async put(key, value) {
      stored.set(key, new TextDecoder().decode(value));
    },
    async get() {
      return null;
    },
    async head() {
      return null;
    },
  };
  const deps: CheckDeps = { client: db, fetcher, bucket, sleep: async (ms) => void sleeps.push(ms), now: () => NOW };
  return { sqlite, db, deps, requests, sleeps, stored };
}

const source = (sqlite: ReturnType<typeof createTestDatabase>["sqlite"]) =>
  sqlite.prepare(`SELECT last_checked_at, last_ok_at, last_error, needs_look FROM cert_source WHERE id = 'bpjph-lhln'`).get() as Record<string, unknown>;

test("an unchanged list is fetched politely, stored in R2, and stops at the hash", async () => {
  const { sqlite, deps, requests, sleeps, stored } = world(seed);
  const result = await runBpjphCheck("bpjph-lhln", deps);
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, true);
  assert.equal(result.rows, 124);
  assert.equal(requests.length, 7);
  assert.equal(requests[0].url, "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri");
  assert.equal(requests[6].url, "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri?page=7");
  assert.ok(requests.every((request) => request.userAgent === CHECK_USER_AGENT));
  assert.deepEqual(sleeps, Array(6).fill(PAGE_DELAY_MS));
  assert.deepEqual([...stored.keys()], Array.from({ length: 7 }, (_, index) => `certifier-sources/bpjph/2026-10-18/page-${index + 1}.html`));
  const snapshots = sqlite.prepare(`SELECT parse_ok, row_count, r2_key FROM cert_snapshot ORDER BY fetched_at`).all() as Record<string, unknown>[];
  assert.equal(snapshots.length, 2, "the seed snapshot and this check");
  assert.equal(snapshots[1].r2_key, "certifier-sources/bpjph/2026-10-18/");
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM cert_change`).get()!.n, 0);
  assert.equal(source(sqlite).last_ok_at, NOW);
  const anic = sqlite.prepare(`SELECT last_checked_at, last_seen_at, updated_at FROM recognition WHERE source_key = ?`).get(ANIC) as Record<string, number>;
  assert.equal(anic.last_checked_at, NOW);
  assert.equal(anic.last_seen_at, NOW);
  assert.ok(anic.updated_at < NOW, "a check is not a data change");
});

test("changes are written, small ones publish, the rest wait for review", async () => {
  const rows = seed
    .filter((row) => row.nama_lhln !== "AL-BAQARA CERTIFICATION")
    .map((row) => {
      if (row.lph_id === ANIC) return { ...row, tgl_berlaku: "2031-06-30", jenis: `${row.jenis}|Consumer Goods` };
      if (row.nama_lhln === "American Halal Foundation (AHF)") return { ...row, nama_lhln: "American Halal Foundation International", jenis: "Food" };
      return row;
    });
  rows.push({ ...seed[0], lph_id: "NEW-BODY-1", nama_lhln: "Brand New Halal Council", negara: "Polandia", no_reg: null });
  const { sqlite, db, deps } = world(rows);
  const result = await runBpjphCheck("bpjph-lhln", deps);
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, false);
  assert.equal(result.published, 2, "ANIC's later date and added scope");
  assert.equal(result.pending, 4, "removal, new body, rename, AHF's removed scopes");
  assert.equal(result.needsLook, false);

  const anic = sqlite.prepare(`SELECT valid_until, scopes, updated_at FROM recognition WHERE source_key = ?`).get(ANIC) as Record<string, unknown>;
  assert.equal(anic.valid_until, "2031-06-30");
  assert.match(String(anic.scopes), /consumer_goods/);
  assert.equal(anic.updated_at, NOW);

  const pending = await listPendingChanges(db);
  assert.deepEqual(pending.map((change) => change.kind).sort(), ["added", "removed", "renamed", "scope_removed"]);
  const created = sqlite.prepare(`SELECT slug, country_code FROM certifier WHERE name = 'Brand New Halal Council'`).get() as Record<string, unknown>;
  assert.deepEqual({ ...created }, { slug: "brand-new-halal-council", country_code: "PL" });
  assert.equal((await getCertifierBySlug("brand-new-halal-council", db)).kind, "missing", "a new body shows once approved");

  const removal = pending.find((change) => change.kind === "removed")!;
  assert.deepEqual(await reviewChange(removal.id, "mod-1", "approve", db, NOW + 1), { ok: true, state: "published" });
  const baqara = sqlite.prepare(`SELECT r.status FROM recognition r JOIN certifier c ON c.id = r.certifier_id WHERE c.slug = 'al-baqara-certification'`).get() as Record<string, unknown>;
  assert.equal(baqara.status, "removed");
  assert.deepEqual(await reviewChange(removal.id, "mod-1", "approve", db), { ok: false, status: 409, error: "That change has already been reviewed." });

  const added = pending.find((change) => change.kind === "added")!;
  await reviewChange(added.id, "mod-1", "approve", db, NOW + 2);
  const page = await getCertifierBySlug("brand-new-halal-council", db);
  assert.equal(page.kind, "found");
  if (page.kind === "found") assert.equal(page.certifier.recognitions[0].status, "recognised");

  const rename = pending.find((change) => change.kind === "renamed")!;
  await reviewChange(rename.id, "mod-1", "approve", db, NOW + 3);
  assert.deepEqual(await getCertifierBySlug("american-halal-foundation-ahf", db), { kind: "moved", slug: "american-halal-foundation-international" });

  const scopeRemoved = pending.find((change) => change.kind === "scope_removed")!;
  assert.deepEqual(await reviewChange(scopeRemoved.id, "mod-1", "reject", db, NOW + 4), { ok: true, state: "rejected" });
  const ahf = sqlite.prepare(`SELECT scopes FROM recognition WHERE certifier_id = ?`).get(scopeRemoved.certifierId) as Record<string, unknown>;
  assert.match(String(ahf.scopes), /cosmetics/, "a rejected removal changes nothing");
  assert.deepEqual(await reviewChange("nope", "mod-1", "approve", db), { ok: false, status: 404, error: "That change could not be found." });

  const audit = sqlite.prepare(`SELECT action FROM audit_log ORDER BY created_at`).all() as { action: string }[];
  assert.deepEqual(audit.map((row) => row.action), ["cert-change-approve", "cert-change-approve", "cert-change-approve", "cert-change-reject"]);
  const published = await listPublishedChanges({ limit: 10 }, db);
  assert.equal(published.length, 5);
  assert.equal(published[0].kind, "renamed");
  assert.equal(published[0].sourceUrl, "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri");
});

test("a list that shrank by more than 10% holds back removals and asks for a look", async () => {
  const { sqlite, deps } = world(seed.slice(0, 100));
  const result = await runBpjphCheck("bpjph-lhln", deps);
  assert.equal(result.ok, true);
  assert.equal(result.suppressedRemovals, 24);
  assert.equal(result.needsLook, true);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM cert_change WHERE kind = 'removed'`).get()!.n, 0);
  assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM recognition WHERE status = 'recognised'`).get()!.n, 124);
  const row = source(sqlite);
  assert.equal(row.needs_look, 1);
  assert.match(String(row.last_error), /shrank from 124 to 100/);
});

test("a page that no longer parses records a failed snapshot and changes nothing", async () => {
  const { sqlite, deps } = world(seed);
  const broken = { ...deps, fetcher: (async (input: string | URL | Request) => new Response(String(input).includes("page=3") ? "<html>new layout</html>" : "", { status: 200 })) as typeof fetch };
  const result = await runBpjphCheck("bpjph-lhln", broken);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /^Page 1: No flight data/);
  const snapshot = sqlite.prepare(`SELECT parse_ok, error FROM cert_snapshot WHERE id != 'bpjph-lhln-2026-10-17-seed'`).get() as Record<string, unknown>;
  assert.equal(snapshot.parse_ok, 0);
  assert.equal(source(sqlite).needs_look, 1);
});

test("a list whose pages disagree with its own count fails the run", async () => {
  const pages = flightPages(seed);
  const { sqlite, deps } = world(seed);
  const short = {
    ...deps,
    fetcher: (async (input: string | URL | Request) => {
      const page = Number(new URL(String(input)).searchParams.get("page") ?? "1");
      return new Response(page === 7 ? pages.get(6)! : pages.get(page)!, { status: 200 });
    }) as typeof fetch,
  };
  const result = await runBpjphCheck("bpjph-lhln", short);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /same body appeared on two pages/);
  assert.equal(source(sqlite).needs_look, 1);
});

test("a busy server is asked again; a missing page is not", async () => {
  const busy = world(seed, { status: (page, attempt) => (page === 2 && attempt === 1 ? 503 : page === 3 && attempt === 1 ? 0 : 200) });
  const ok = await runBpjphCheck("bpjph-lhln", busy.deps);
  assert.equal(ok.ok, true);
  assert.equal(busy.requests.length, 9);

  const gone = world(seed, { status: () => 404 });
  const failed = await runBpjphCheck("bpjph-lhln", gone.deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "The list answered HTTP 404.");
  assert.equal(gone.requests.length, 1);
  assert.equal(source(gone.sqlite).needs_look, 1);

  const down = world(seed, { status: () => 0 });
  assert.equal((await runBpjphCheck("bpjph-lhln", down.deps)).error, "The list could not be reached.");
  assert.equal(down.requests.length, 3);
});

test("runCertifierChecks runs every active source with a known parser", async () => {
  const { sqlite, deps } = world(seed);
  sqlite.prepare(`INSERT INTO cert_source (id, authority_id, url, kind, parser) VALUES ('later', 'bpjph', 'https://example.org', 'pdf', 'unknown')`).run();
  const results = await runCertifierChecks(deps);
  assert.deepEqual(results.map((result) => [result.sourceId, result.unchanged]), [["bpjph-lhln", true]]);
});
