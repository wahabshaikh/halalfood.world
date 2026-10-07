import { readFileSync } from "node:fs";

export type D1Config = { binding: string; database_name: string; database_id: string; migrations_dir?: string };
export type RateLimitConfig = { name: string; namespace_id: string; simple?: { limit?: number; period?: number } };

export type BindingSet = {
  vars?: Record<string, string>;
  d1_databases?: D1Config[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  kv_namespaces?: { binding: string; id: string }[];
  ratelimits?: RateLimitConfig[];
  send_email?: { name: string; allowed_sender_addresses?: string[] }[];
  queues?: { producers?: unknown[]; consumers?: unknown[] };
  routes?: unknown[];
  triggers?: { crons?: string[] };
  images?: { binding: string };
  ai?: { binding: string };
};

export type WranglerConfig = BindingSet & { name: string; account_id?: string; previews?: BindingSet };

/** Strip JSONC comments and trailing commas without touching `//` inside strings (URLs). */
export function parseJsonc(source: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      out += char;
      if (char === "\\") out += source[++i] ?? "";
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** wrangler.jsonc from the repo root, for tests and scripts. */
export function readWranglerConfig(path = new URL("../wrangler.jsonc", import.meta.url)): WranglerConfig {
  return parseJsonc(readFileSync(path, "utf8")) as WranglerConfig;
}
