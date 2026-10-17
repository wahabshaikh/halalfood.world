"use client";

/**
 * The hub's cross-country table: one row per certifier, one column per importing country, filtered by a
 * name search (official name and every alias we have seen), where the body is based, and product scope.
 */
import { useMemo, useState } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normaliseName } from "@/lib/certifiers/names";
import { SCOPE_LABELS, type ScopeCode } from "@/lib/certifiers/scopes";
import type { DisplayStatus } from "@/lib/certifiers/display";
import { CertStatusPill } from "./certifier-bits";
import { Icon } from "./kit";

export type DirectoryCell = { status: DisplayStatus; validText: string; scopes: ScopeCode[] } | null;

export type DirectoryEntry = {
  slug: string;
  name: string;
  aliases: string[];
  countryCode: string | null;
  basedIn: string;
  /** Keyed by importing-country slug. */
  cells: Record<string, DirectoryCell>;
};

export type DirectoryColumn = { slug: string; name: string; authorityShort: string };

const SELECT_CLASS =
  "min-h-11 rounded-xl border border-input bg-background px-3 text-sm font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function CertifierDirectory({
  entries,
  columns,
  countries,
}: {
  entries: DirectoryEntry[];
  columns: DirectoryColumn[];
  countries: { code: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [scope, setScope] = useState("");

  const shown = useMemo(() => {
    const needle = normaliseName(query);
    return entries.filter(
      (entry) =>
        (!needle || normaliseName(entry.name).includes(needle) || entry.aliases.some((alias) => alias.includes(needle))) &&
        (!country || entry.countryCode === country) &&
        (!scope || Object.values(entry.cells).some((cell) => cell?.scopes.includes(scope as ScopeCode))),
    );
  }, [entries, query, country, scope]);

  return (
    <div className="grid gap-3">
      <form role="search" onSubmit={(event) => event.preventDefault()} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="flex min-h-12 items-center gap-2.5 rounded-full bg-secondary px-4 focus-within:ring-2 focus-within:ring-ring">
          <Icon icon={Search01Icon} size={20} className="shrink-0" />
          <span className="sr-only">Type your certifier</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type your certifier"
            maxLength={120}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted-foreground"
          />
        </label>
        <label className="grid">
          <span className="sr-only">Certifier based in</span>
          <select value={country} onChange={(event) => setCountry(event.target.value)} className={SELECT_CLASS}>
            <option value="">Based anywhere</option>
            {countries.map((each) => (
              <option key={each.code} value={each.code}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid">
          <span className="sr-only">Product scope</span>
          <select value={scope} onChange={(event) => setScope(event.target.value)} className={SELECT_CLASS}>
            <option value="">Any scope</option>
            {(Object.keys(SCOPE_LABELS) as ScopeCode[]).map((code) => (
              <option key={code} value={code}>
                {SCOPE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>
      </form>
      <p className="text-sm font-semibold text-muted-foreground" aria-live="polite">
        {shown.length === entries.length ? `${entries.length} certifiers` : `${shown.length} of ${entries.length} certifiers`}
      </p>
      <div className="rounded-2xl border border-border">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3 font-black text-foreground">Certifier</TableHead>
              <TableHead className="px-3 font-black text-foreground">Based in</TableHead>
              {columns.map((column) => (
                <TableHead key={column.slug} className="px-3 font-black text-foreground">
                  <a href={`/certifiers/country/${column.slug}`} className="underline-offset-4 hover:underline">
                    {column.name} ({column.authorityShort})
                  </a>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((entry) => (
              <TableRow key={entry.slug} className="align-top">
                <TableCell className="max-w-80 px-3 py-3 whitespace-normal">
                  <a href={`/certifiers/${entry.slug}`} className="font-extrabold underline-offset-4 hover:text-primary hover:underline">
                    {entry.name}
                  </a>
                </TableCell>
                <TableCell className="max-w-48 px-3 py-3 whitespace-normal text-subtle-foreground">{entry.basedIn}</TableCell>
                {columns.map((column) => {
                  const cell = entry.cells[column.slug];
                  return (
                    <TableCell key={column.slug} className="px-3 py-3 whitespace-normal">
                      {cell ? (
                        <div className="grid justify-items-start gap-1">
                          <CertStatusPill status={cell.status} />
                          <span className="text-xs font-bold text-subtle-foreground">{cell.validText}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not listed</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!shown.length && (
          <p className="p-6 text-center text-sm font-semibold text-muted-foreground">
            No certifier matches. A body that is not here is not on any official list we check yet.
          </p>
        )}
      </div>
    </div>
  );
}
