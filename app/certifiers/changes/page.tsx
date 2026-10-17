import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { CertifiersNav, ConfirmNote, JsonLd } from "@/components/hf/certifier-bits";
import { Page, PageTitle } from "@/components/hf/kit";
import { CHANGE_LABEL, changeSentence, formatDay } from "@/lib/certifiers/display";
import { importingCountryForAuthority } from "@/lib/certifiers/importing";
import { listPublishedChanges } from "@/lib/certifiers/repository";
import { sectionTitle } from "@/lib/certifiers/seo";
import { breadcrumbJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: sectionTitle("Changes to official halal certifier lists") },
  description: "Every certification body added to, removed from, renewed on or renamed on the official lists we check, newest first, with the date we saw it.",
  alternates: { canonical: "/certifiers/changes", types: { "application/atom+xml": "/certifiers/changes.xml" } },
};

export default async function ChangesPage() {
  const changes = await listPublishedChanges({ limit: 200 });
  return (
    <AppShell>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "halalfood.world", path: "/" },
          { name: "Halal certifiers", path: "/certifiers" },
          { name: "Changes", path: "/certifiers/changes" },
        ])}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav active="/certifiers/changes" />
            <PageTitle
              sub={
                <>
                  What changed on the official lists, newest first. Also as a{" "}
                  <a href="/certifiers/changes.xml" className="font-extrabold underline underline-offset-4">
                    feed
                  </a>
                  .
                </>
              }
            >
              Change log
            </PageTitle>
          </div>
          {changes.length ? (
            <ol className="grid max-w-3xl gap-3">
              {changes.map((change) => {
                const authority = importingCountryForAuthority(change.authorityId);
                const short = authority?.authorityShort ?? change.authorityId;
                return (
                  <li key={change.id} className="grid gap-1 border-b border-border pb-3">
                    <span className="text-sm font-bold text-muted-foreground">
                      {formatDay(change.publishedAt)} · {CHANGE_LABEL[change.kind]} · {authority ? `${authority.name} (${short})` : short}
                    </span>
                    <span className="text-[15px]">
                      <a href={`/certifiers/${change.certifierSlug}`} className="font-extrabold underline-offset-4 hover:underline">
                        {change.certifierName}
                      </a>
                      : {changeSentence(change.kind, change.before, change.after, short)}
                    </span>
                    {change.sourceUrl && (
                      <span className="text-xs text-muted-foreground">
                        Seen on the{" "}
                        <a href={change.sourceUrl} rel="noopener" className="underline underline-offset-4">
                          official list
                        </a>
                        {change.snapshotFetchedAt ? ` on ${formatDay(change.snapshotFetchedAt)}` : ""}.
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="max-w-3xl text-[15px] text-subtle-foreground">
              No changes yet. We first copied BPJPH&apos;s list on 17 Oct 2026; from then on, every body added, removed, renewed or renamed shows here.
            </p>
          )}
          <ConfirmNote />
        </div>
      </Page>
    </AppShell>
  );
}
