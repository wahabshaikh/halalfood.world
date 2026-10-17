"use client";

/**
 * One authority's full list as a table: rendered whole on the server (crawlable without JavaScript),
 * then filterable by name, country and scope and sortable by name, country and date in the browser.
 */
import { useMemo, useState } from "react";
import { ArrowDown01Icon, ArrowUp01Icon, Search01Icon, Sorting05Icon } from "@hugeicons/core-free-icons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normaliseName } from "@/lib/certifiers/names";
import { SCOPE_LABELS, type ScopeCode } from "@/lib/certifiers/scopes";
import type { DisplayStatus } from "@/lib/certifiers/display";
import { cn } from "@/lib/utils";
import { CertStatusPill } from "./certifier-bits";
import { Icon } from "./kit";

export type CertifierTableRow = {
  slug: string;
  name: string;
  countryCode: string | null;
  countryName: string | null;
  city: string | null;
  scopes: ScopeCode[];
  scopesRaw: string | null;
  validUntil: string | null;
  validText: string;
  status: DisplayStatus;
  sourceRef: string | null;
};

type SortKey = "name" | "country" | "validUntil";

const SELECT_CLASS =
  "min-h-11 rounded-xl border border-input bg-background px-3 text-sm font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function compare(a: CertifierTableRow, b: CertifierTableRow, key: SortKey): number {
  if (key === "validUntil") {
    // Rows without a date sort last either way round.
    if (a.validUntil === b.validUntil) return a.name.localeCompare(b.name);
    if (!a.validUntil) return 1;
    if (!b.validUntil) return -1;
    return a.validUntil < b.validUntil ? -1 : 1;
  }
  if (key === "country") return (a.countryName ?? "~").localeCompare(b.countryName ?? "~") || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

export function CertifierTable({ rows, refLabel }: { rows: CertifierTableRow[]; refLabel: string }) {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [scope, setScope] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const countries = useMemo(
    () =>
      [...new Map(rows.filter((row) => row.countryCode).map((row) => [row.countryCode as string, row.countryName ?? row.countryCode])).entries()].sort((a, b) =>
        String(a[1]).localeCompare(String(b[1])),
      ),
    [rows],
  );
  const scopes = useMemo(() => (Object.keys(SCOPE_LABELS) as ScopeCode[]).filter((code) => rows.some((row) => row.scopes.includes(code))), [rows]);

  const shown = useMemo(() => {
    const needle = normaliseName(query);
    const raw = query.trim().toLowerCase();
    return rows
      .filter((row) => !needle || normaliseName(row.name).includes(needle) || (raw.length > 2 && row.sourceRef?.toLowerCase().includes(raw)))
      .filter((row) => !country || row.countryCode === country)
      .filter((row) => !scope || row.scopes.includes(scope as ScopeCode))
      .sort((a, b) => compare(a, b, sort.key) * sort.dir);
  }, [rows, query, country, scope, sort]);

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <TableHead aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3">
        <button
          type="button"
          onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}
          className="inline-flex min-h-10 items-center gap-1 font-black text-foreground hover:text-primary"
        >
          {label}
          <Icon icon={active ? (sort.dir === 1 ? ArrowUp01Icon : ArrowDown01Icon) : Sorting05Icon} size={14} className={cn(!active && "text-muted-foreground")} />
        </button>
      </TableHead>
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-input px-3 focus-within:ring-2 focus-within:ring-ring">
          <Icon icon={Search01Icon} size={18} className="shrink-0 text-muted-foreground" />
          <span className="sr-only">Search by name or registration number</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type your certifier"
            maxLength={120}
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground"
          />
        </label>
        <label className="grid">
          <span className="sr-only">Based in</span>
          <select value={country} onChange={(event) => setCountry(event.target.value)} className={SELECT_CLASS}>
            <option value="">All countries</option>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid">
          <span className="sr-only">Scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)} className={SELECT_CLASS}>
            <option value="">All scopes</option>
            {scopes.map((code) => (
              <option key={code} value={code}>
                {SCOPE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm font-semibold text-muted-foreground" aria-live="polite">
        Showing {shown.length} of {rows.length}
      </p>
      <div className="rounded-2xl border border-border">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {header("name", "Certifier")}
              {header("country", "Based in")}
              <TableHead className="px-3 font-black text-foreground">Scopes</TableHead>
              {header("validUntil", "Valid until")}
              <TableHead className="px-3 font-black text-foreground">{refLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              <TableRow key={row.slug} className="align-top">
                <TableCell className="max-w-72 px-3 py-3 whitespace-normal">
                  <a href={`/certifiers/${row.slug}`} className="font-extrabold text-foreground underline-offset-4 hover:text-primary hover:underline">
                    {row.name}
                  </a>
                </TableCell>
                <TableCell className="max-w-48 px-3 py-3 whitespace-normal text-subtle-foreground">
                  {[row.city, row.countryName].filter(Boolean).join(", ") || "Not given"}
                </TableCell>
                <TableCell className="max-w-64 px-3 py-3 whitespace-normal" title={row.scopesRaw ? `Official wording: ${row.scopesRaw.split("|").join(", ")}` : undefined}>
                  {row.scopes.map((code) => SCOPE_LABELS[code]).join(", ") || row.scopesRaw || "Not given"}
                </TableCell>
                <TableCell className="px-3 py-3 whitespace-normal">
                  <div className="grid justify-items-start gap-1">
                    {row.status !== "recognised" && <CertStatusPill status={row.status} />}
                    <span className={cn("font-bold", !row.validUntil && "text-muted-foreground")}>{row.validText}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-56 px-3 py-3 font-mono text-xs break-all whitespace-normal text-subtle-foreground">{row.sourceRef ?? "Not given"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!shown.length && <p className="p-6 text-center text-sm font-semibold text-muted-foreground">No certifier on this list matches. Check the spelling, or try fewer words.</p>}
      </div>
    </div>
  );
}
