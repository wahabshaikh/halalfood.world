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
        title: `We couldn’t find ${domain}.`,
        detail: "The link does not match a page. Nothing else was cleared.",
        retry: false,
      };
    case 429:
      return {
        title: `Requests for ${domain} are rate limited.`,
        detail: "Wait a moment, then try again. Nothing you typed was cleared.",
        retry: true,
      };
    case 503:
      return {
        title: `We couldn’t load ${domain}.`,
        detail: "Try again. An empty list is not what this means, and nothing was cleared.",
        retry: true,
      };
    case "offline":
      return {
        title: `You appear to be offline.`,
        detail: `We couldn’t reach ${domain}. Try again when you are back online. Nothing was cleared.`,
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
 * A server `error` string is shown with a support reference. A missing or raw
 * fetch string falls back to the status copy, so "Failed to fetch" never
 * reaches the UI.
 */
export function presentHttpFailure(
  domain: string,
  status: number,
  serverMessage: string | null | undefined,
): PresentedFailure {
  const server = serverMessage?.trim() ?? "";
  const kind = failureKindFromStatus(status) ?? 503;
  const copy = failureCopy(kind, domain);
  if (server && !isRawFetchMessage(server)) {
    const sentence = /[.!?]$/.test(server) ? server : `${server}.`;
    return { message: `${sentence} Reference ${supportReference()}.`, retry: copy.retry };
  }
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

/** A place-page block failure, with whether to offer a sign-in link. */
export type BlockFailure = PresentedFailure & {
  /** "signed-out" when a session was lost, "sign-in" when there never was one. */
  signIn: "signed-out" | "sign-in" | null;
};

/**
 * Copy for a failed read of a place-page block (halal checks, photos,
 * reviews), by status. Each one says what happened and whether trying again
 * can help; a reference goes with it. 401 and 403 never offer Try again: the
 * same request would fail the same way.
 */
export function placeBlockLoadFailure(
  noun: string,
  status: number,
  hadSession = false,
): BlockFailure {
  switch (status) {
    case 404:
      return {
        ...presentHttpFailure(
          "this place",
          404,
          `This place is no longer listed, so its ${noun} cannot be shown`,
        ),
        retry: false,
        signIn: null,
      };
    case 429:
      return {
        ...presentHttpFailure(
          `the ${noun}`,
          429,
          `Too many requests for ${noun} just now. Wait a moment, then try again`,
        ),
        retry: true,
        signIn: null,
      };
    case 401:
      return {
        ...presentHttpFailure(
          `the ${noun}`,
          401,
          hadSession
            ? `You've been signed out, so the ${noun} for this place did not load. Sign in again to see them`
            : `Sign in to see the ${noun} for this place`,
        ),
        retry: false,
        signIn: hadSession ? "signed-out" : "sign-in",
      };
    case 403:
      return {
        ...presentHttpFailure(
          `the ${noun}`,
          403,
          `You don't have access to the ${noun} for this place`,
        ),
        retry: false,
        signIn: null,
      };
    default:
      return {
        ...presentHttpFailure(
          `the ${noun}`,
          503,
          status >= 500
            ? `The ${noun} for this place did not load because of a server problem. Nothing was lost`
            : `The ${noun} for this place did not load. Nothing was lost`,
        ),
        retry: true,
        signIn: null,
      };
  }
}

/** A block read that never got a response, or got one it could not read. */
export function placeBlockTransportFailure(noun: string, error: unknown): BlockFailure {
  return { ...presentTransportFailure(`the ${noun} for this place`, error), retry: true, signIn: null };
}

/** The halal-checks block. */
export function checksLoadFailure(status: number, hadSession = false): BlockFailure {
  return placeBlockLoadFailure("halal checks", status, hadSession);
}
