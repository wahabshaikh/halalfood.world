export type FailureKind = 401 | 403 | 404 | 429 | 503 | "offline";

export type FailureCopy = {
  title: string;
  detail: string;
  retry: boolean;
};

/** Copy for a failed read. A failure is not an empty list. */
export function failureCopy(kind: FailureKind, domain = "This page"): FailureCopy {
  switch (kind) {
    case 401:
      return {
        title: `Sign in to open ${domain}.`,
        detail: "You are not signed in. Nothing already on screen was cleared.",
        retry: false,
      };
    case 403:
      return {
        title: `You cannot open ${domain}.`,
        detail: "This account does not have access. Nothing already on screen was cleared.",
        retry: false,
      };
    case 404:
      return {
        title: `${domain} is not here.`,
        detail: "The link does not match a page. Nothing else was cleared.",
        retry: false,
      };
    case 429:
      return {
        title: `${domain} is rate limited.`,
        detail: "Wait a moment, then try again. Nothing you typed was cleared.",
        retry: true,
      };
    case 503:
      return {
        title: `${domain} is temporarily unavailable.`,
        detail: "Try again. An empty list is not what this means, and nothing was cleared.",
        retry: true,
      };
    case "offline":
      return {
        title: `You appear to be offline.`,
        detail: `${domain} could not be reached. Try again when you are back online. Nothing was cleared.`,
        retry: true,
      };
  }
}

const NAMED_STATUS: readonly FailureKind[] = [401, 403, 404, 429, 503];

/** Map an HTTP status onto a failure kind. Unknown statuses are not a kind. */
export function failureKindFromStatus(status: number): FailureKind | null {
  return NAMED_STATUS.find((kind) => kind === status) ?? null;
}

/**
 * A fetch that never produced a response. Browsers throw `TypeError` with
 * "Failed to fetch" (or "Load failed") when the device is offline.
 */
export function failureKindFromError(error: unknown): FailureKind {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    name === "TypeError" ||
    /failed to fetch|networkerror|load failed|network request failed|offline/i.test(message)
  )
    return "offline";
  return 503;
}

/** Short support reference. The raw error text is never part of it. */
export function supportReference(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function formatFailure(kind: FailureKind, domain: string, reference?: string): string {
  const copy = failureCopy(kind, domain);
  return reference ? `${copy.title} ${copy.detail} Reference ${reference}.` : `${copy.title} ${copy.detail}`;
}

export type PresentedFailure = {
  message: string;
  retry: boolean;
};

/** Browser fetch failures. These strings must never be shown to a diner. */
const RAW_FETCH_MESSAGE = /failed to fetch|load failed/i;

export function isRawFetchMessage(message: string): boolean {
  return RAW_FETCH_MESSAGE.test(message);
}

/**
 * Copy for an HTTP error from a route that already returned JSON.
 * A server `error` string is shown as-is. A missing or raw fetch string
 * falls back to the status copy, so "Failed to fetch" never reaches the UI.
 */
export function presentHttpFailure(
  domain: string,
  status: number,
  serverMessage: string | null | undefined,
): PresentedFailure {
  const server = serverMessage?.trim() ?? "";
  const kind = failureKindFromStatus(status) ?? 503;
  const copy = failureCopy(kind, domain);
  if (server && !isRawFetchMessage(server)) return { message: server, retry: copy.retry };
  return { message: formatFailure(kind, domain, supportReference()), retry: copy.retry };
}

/**
 * Copy for a fetch that never produced a response. The exception text
 * ("Failed to fetch", "Load failed") is not part of the message.
 */
export function presentTransportFailure(domain: string, error: unknown): PresentedFailure {
  const kind = failureKindFromError(error);
  const copy = failureCopy(kind, domain);
  return { message: formatFailure(kind, domain, supportReference()), retry: copy.retry };
}

/**
 * Copy for a failed client read. `response` null means the request never
 * completed (offline). The message never repeats the raw exception text.
 */
export async function presentFetchFailure(
  domain: string,
  response: Response | null,
  error: unknown,
): Promise<PresentedFailure> {
  let reference: string | undefined;
  if (response) {
    try {
      const body = (await response.clone().json()) as { reference?: unknown };
      if (typeof body.reference === "string" && /^[A-Za-z0-9-]{4,40}$/.test(body.reference))
        reference = body.reference.slice(0, 16);
    } catch {
      // A non-JSON body still gets a client reference below.
    }
  }
  const kind = response
    ? (failureKindFromStatus(response.status) ?? 503)
    : failureKindFromError(error);
  const copy = failureCopy(kind, domain);
  return {
    message: formatFailure(kind, domain, reference ?? supportReference()),
    retry: copy.retry,
  };
}
