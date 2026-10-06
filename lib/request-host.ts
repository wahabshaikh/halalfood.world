/** The request's hostname, lowercased, without port or brackets. Environment checks live in `environment.ts`. */
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
