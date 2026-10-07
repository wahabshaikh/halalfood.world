/** Routes where a fixed Next, Back or Send must stay above the support chat. */
const FOCUSED_FLOW = /^\/(?:welcome|add|login)(?:\/|$)|\/place\/[^/]+\/check(?:\/|$)/;

export function isFocusedFlow(pathname: string): boolean {
  return FOCUSED_FLOW.test(pathname);
}
