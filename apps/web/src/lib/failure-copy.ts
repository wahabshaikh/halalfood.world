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
