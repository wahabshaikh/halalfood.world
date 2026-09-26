import type { StatusCopy } from "@halalfood/core/halal-taxonomy";

export type StatusTone = StatusCopy["tone"];

/** Badge variant for each halal status tone. */
export const TONE_BADGE = {
  verified: "success",
  community: "info",
  options: "warning",
  declared: "muted",
  unknown: "muted",
  negative: "destructive",
} as const satisfies Record<StatusTone, string>;

/** Text colour for each halal status tone. */
export const TONE_TEXT: Record<StatusTone, string> = {
  verified: "text-success",
  community: "text-info",
  options: "text-warning-foreground",
  declared: "text-muted-foreground",
  unknown: "text-muted-foreground",
  negative: "text-destructive",
};

/** Accent border colour for each halal status tone. */
export const TONE_BORDER: Record<StatusTone, string> = {
  verified: "border-l-success",
  community: "border-l-info",
  options: "border-l-warning",
  declared: "border-l-muted-foreground",
  unknown: "border-l-muted-foreground",
  negative: "border-l-destructive",
};
