/**
 * The normal Turnstile widget is 300px wide. Page padding plus the login card
 * padding leave less than that until the viewport is wider than 360px, so the
 * compact widget is used through 400px.
 */
export const TURNSTILE_COMPACT_MAX_WIDTH = 400;

export function turnstileWidgetSize(viewportWidth: number): "compact" | "normal" {
  return viewportWidth <= TURNSTILE_COMPACT_MAX_WIDTH ? "compact" : "normal";
}
