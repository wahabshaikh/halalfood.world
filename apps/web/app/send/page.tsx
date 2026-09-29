import type { Metadata } from "next";
import { placeIdParam } from "@halalfood/core/params";
import { normalizeHandle } from "@halalfood/core/social";
import { Page, PageMain, SiteFooter, SiteHeader } from "../../src/components/site-chrome";
import { getViewerId } from "../../src/lib/auth-session";
import { describeRecTarget } from "../../src/lib/recs-repository";
import SendView from "./send-view";

export const metadata: Metadata = {
  title: "Send a rec",
  description: "Send a halal place or list to friends, with a short note.",
  alternates: { canonical: "/send" },
  robots: { index: false, follow: true },
};

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : null);
  const placeId = placeIdParam(one("place"));
  const listId = placeId ? null : placeIdParam(one("list"));
  const target = placeId
    ? { kind: "place" as const, id: placeId }
    : listId
      ? { kind: "list" as const, id: listId }
      : null;
  let described = null;
  if (target) {
    try {
      described = await describeRecTarget(target, await getViewerId());
    } catch {
      described = null;
    }
  }
  return (
    <Page>
      <SiteHeader hideSearch />
      <PageMain narrow>
        <h1 className="mb-1.5 text-[clamp(24px,3vw,30px)]">Send a rec</h1>
        <p className="mb-6 text-muted-foreground">
          Pick friends and add a note. It goes to their recs inbox. There is no chat.
        </p>
        <SendView target={described} unavailable={Boolean(target) && !described} to={normalizeHandle(one("to"))} />
      </PageMain>
      <SiteFooter />
    </Page>
  );
}
