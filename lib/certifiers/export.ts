/**
 * Plain-text exports: the CSV of a country's list and the Atom feed of published changes.
 */
import { escapeXml } from "@/lib/sitemap";

/** RFC 4180 field: quoted when it holds a comma, quote or line break. Leading formula characters are defused. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export type AtomEntry = { id: string; title: string; summary: string; link: string; updated: Date };

export function atomFeed(feed: { id: string; title: string; selfLink: string; htmlLink: string; updated: Date; entries: AtomEntry[] }): string {
  const entries = feed.entries
    .map(
      (entry) =>
        "<entry>\n" +
        `<id>${escapeXml(entry.id)}</id>\n` +
        `<title>${escapeXml(entry.title)}</title>\n` +
        `<link href="${escapeXml(entry.link)}"/>\n` +
        `<updated>${entry.updated.toISOString()}</updated>\n` +
        `<summary>${escapeXml(entry.summary)}</summary>\n` +
        "</entry>\n",
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
    `<id>${escapeXml(feed.id)}</id>\n` +
    `<title>${escapeXml(feed.title)}</title>\n` +
    `<link rel="self" href="${escapeXml(feed.selfLink)}"/>\n` +
    `<link href="${escapeXml(feed.htmlLink)}"/>\n` +
    `<updated>${feed.updated.toISOString()}</updated>\n` +
    "<author><name>halalfood.world</name></author>\n" +
    entries +
    "</feed>\n"
  );
}
