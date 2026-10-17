import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flightPage } from "@/lib/testing/certifier-pages";
import { bpjphPageUrl, canonicalRowsJson, flightText, parseBpjphPage, sha256Hex, toSourceRow, type BpjphRawRow } from "./bpjph";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "../../tests/fixtures/certifiers", name), "utf8");
const seed = JSON.parse(readFileSync(join(import.meta.dirname, "../../seed/certifiers/bpjph-lhln-2026-10-17.json"), "utf8")) as BpjphRawRow[];

test("page 1 of the saved BPJPH list parses to 20 rows and the page counts", () => {
  const page = parseBpjphPage(fixture("p1.html"));
  assert.ok(page.ok);
  if (!page.ok) return;
  assert.equal(page.rows.length, 20);
  assert.deepEqual(page.meta, { currentPage: 1, totalItems: 124, pageSize: 20, totalPages: 7 });
  assert.equal(page.rows[0].nama_lhln, "AL-BAQARA CERTIFICATION");
  const anic = page.rows.find((row) => row.nama_lhln === "ANIC Halal Authority");
  assert.equal(anic?.tgl_berlaku, "2030-06-30");
  assert.equal(anic?.negara, "Australia");
});

test("the last page parses its 4 rows, keeping trailing spaces as the source writes them", () => {
  const page = parseBpjphPage(fixture("p7.html"));
  assert.ok(page.ok);
  if (!page.ok) return;
  assert.equal(page.rows.length, 4);
  assert.equal(page.meta.currentPage, 7);
  assert.equal(page.rows[0].nama_lhln, "Western Australia Halal Authority ");
});

test("the fixtures agree with the saved seed list row for row", () => {
  for (const name of ["p1.html", "p7.html"]) {
    const page = parseBpjphPage(fixture(name));
    assert.ok(page.ok);
    if (!page.ok) return;
    for (const row of page.rows) assert.deepEqual(row, seed.find((each) => each.lph_id === row.lph_id));
  }
});

test("a page without flight data, without the table, or with a broken table is an error, never an empty list", () => {
  assert.deepEqual(parseBpjphPage("<html>Maintenance</html>"), { ok: false, error: "No flight data on the page." });
  assert.equal(parseBpjphPage(`<script>self.__next_f.push([1,"hello"])</script>`).ok, false);
  const empty = parseBpjphPage(flightPage([], { currentPage: 1, totalItems: 0, totalPages: 0 }));
  assert.deepEqual(empty, { ok: false, error: "The list is empty." });
  const cut = `<script>self.__next_f.push([1,${JSON.stringify('x:{"data":[{"lph_id":"A","nama_lhln":"B"')}])</script>`;
  assert.deepEqual(parseBpjphPage(cut), { ok: false, error: "The table data is cut off." });
  const noName = flightPage([{ lph_id: "A", nama_lhln: " " }], { currentPage: 1, totalItems: 1, totalPages: 1 });
  assert.deepEqual(parseBpjphPage(noName), { ok: false, error: "A table row has no id or name." });
  const noMeta = `<script>self.__next_f.push([1,${JSON.stringify('x:{"data":[{"lph_id":"A","nama_lhln":"B"}]}')}])</script>`;
  assert.deepEqual(parseBpjphPage(noMeta), { ok: false, error: "The page counts were not found." });
  const bad = `<script>self.__next_f.push([1,${JSON.stringify('x:{"data":[{"lph_id":"A",nama_lhln}]}')}])</script>`;
  assert.deepEqual(parseBpjphPage(bad), { ok: false, error: "The table data is not valid JSON." });
});

test("flight strings unescape RSC's $$ and drop $undefined", () => {
  const page = parseBpjphPage(flightPage([{ lph_id: "A", nama_lhln: "$$Dollar Halal", alamat: "$undefined", jenis: "Food" }], { currentPage: 1, totalItems: 1, totalPages: 1 }));
  assert.ok(page.ok);
  if (!page.ok) return;
  assert.equal(page.rows[0].nama_lhln, "$Dollar Halal");
  assert.equal(page.rows[0].alamat, null);
  assert.equal(page.rows[0].kota, null);
});

test("flightText skips chunks that are not plain strings", () => {
  assert.equal(flightText(`<script>self.__next_f.push([1,"a"])</script><script>self.__next_f.push([1,"b\\u0021"])</script>`), "ab!");
});

test("a raw row becomes a stored row: name trimmed, country and scopes mapped, nothing invented", () => {
  const anic = toSourceRow(seed.find((row) => row.nama_lhln === "ANIC Halal Authority")!);
  assert.equal(anic.name, "ANIC Halal Authority");
  assert.equal(anic.countryCode, "AU");
  assert.equal(anic.validUntil, "2030-06-30");
  assert.equal(anic.sourceStatus, "MRA");
  assert.deepEqual(anic.scopes, ["food", "beverages", "meat_slaughter", "drugs_pharma", "cosmetics"]);
  assert.equal(anic.scopesRaw, "Food|Beverages|Drugs/Pharmaceuticals|Cosmetics|Slaughtering services");

  const muis = toSourceRow(seed.find((row) => row.tgl_berlaku === null)!);
  assert.equal(muis.validUntil, null);
  assert.equal(muis.sourceRef, null);

  const trimmed = toSourceRow({ ...seed[0], nama_lhln: " Spaced Name ", no_reg: "  ", tgl_berlaku: "2029-02-30", negara: "Atlantis", kota: "" });
  assert.equal(trimmed.name, "Spaced Name");
  assert.equal(trimmed.sourceRef, null);
  assert.equal(trimmed.validUntil, null, "an impossible date is no date");
  assert.equal(trimmed.countryCode, null);
  assert.equal(trimmed.countryRaw, "Atlantis");
  assert.equal(trimmed.city, null);
  assert.equal(toSourceRow({ ...seed[0], tgl_berlaku: "2028-02-20T00:00:00.000Z" }).validUntil, "2028-02-20");
});

test("the canonical form ignores row order, so the hash only moves when the list does", async () => {
  const reversed = [...seed].reverse();
  assert.equal(await sha256Hex(canonicalRowsJson(seed)), await sha256Hex(canonicalRowsJson(reversed)));
  const changed = seed.map((row, index) => (index === 0 ? { ...row, tgl_berlaku: "2031-01-01" } : row));
  assert.notEqual(await sha256Hex(canonicalRowsJson(seed)), await sha256Hex(canonicalRowsJson(changed)));
  assert.match(await sha256Hex("x"), /^[0-9a-f]{64}$/);
});

test("page URLs", () => {
  assert.equal(bpjphPageUrl(1), "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri");
  assert.equal(bpjphPageUrl(3), "https://bpjph.halal.go.id/cari/lembaga-halal-luar-negeri?page=3");
});
