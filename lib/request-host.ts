/**
 * Preview detection uses the request host. Workers Builds previews set
 * `BETTER_AUTH_URL` to https://halalfood.world, so that variable cannot tell
 * a preview request from production.
 */
export function requestHostname(value: string | null | undefined): string {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw) return "";
  if (raw.includes("://")) {
    try {
      return new URL(raw).hostname;
    } catch {
      return "";
    }
  }
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 1 ? raw.slice(1, end) : "";
  }
  const colon = raw.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(raw.slice(colon + 1))) return raw.slice(0, colon);
  return raw;
}

export function hostFromRequest(request: Request): string {
  try {
    const hostname = new URL(request.url).hostname;
    if (hostname) return hostname;
  } catch {
    // Some test requests use a relative URL. The Host header is the fallback.
  }
  return requestHostname(request.headers.get("host"));
}

/** True only for `*.workers.dev`. `halalfood.world` is never a preview host. */
export function isPreviewHost(value: string | null | undefined): boolean {
  const host = requestHostname(value);
  if (!host || host === "halalfood.world" || host.endsWith(".halalfood.world")) return false;
  return host.endsWith(".workers.dev");
}
