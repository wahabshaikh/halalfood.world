import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download04Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "@/components/hf/app-shell";
import { CertifierTable } from "@/components/hf/certifier-table";
import { CertifiersNav, CheckedLine, ConfirmNote, JsonLd } from "@/components/hf/certifier-bits";
import { Icon, LinkButton, Page, PageTitle, SectionTitle } from "@/components/hf/kit";
import { CHANGE_LABEL, changeSentence, formatDay, isoToday } from "@/lib/certifiers/display";
import { importingCountry } from "@/lib/certifiers/importing";
import { listCurrentRecognitions, listPublishedChanges, listSources } from "@/lib/certifiers/repository";
import { countryDatasetJsonLd, countryPageTitle } from "@/lib/certifiers/seo";
import { tableRows } from "@/lib/certifiers/views";
import { breadcrumbJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ country: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const country = importingCountry((await params).country);
  if (!country) return { title: "Not found", robots: { index: false } };
  const source = (await listSources().catch(() => [])).find((each) => each.id === country.sourceId);
  return {
    title: { absolute: countryPageTitle(country, source?.lastOkAt ?? null) },
    description: `Every foreign halal certification body ${country.authorityShort} recognises for products going to ${country.name}: scopes, valid-until dates and registration numbers, checked against the official list.`,
    alternates: { canonical: `/certifiers/country/${country.slug}` },
  };
}

export default async function CountryPage({ params }: Props) {
  const country = importingCountry((await params).country);
  if (!country) notFound();
  const [recs, sources, changes] = await Promise.all([
    listCurrentRecognitions({ authorityId: country.authorityId }),
    listSources(),
    listPublishedChanges({ authorityId: country.authorityId, limit: 20 }),
  ]);
  const source = sources.find((each) => each.id === country.sourceId);
  const officialUrl = source?.url ?? "https://bpjph.halal.go.id";
  const today = isoToday();
  const modifiedAt = Math.max(0, ...recs.map((rec) => rec.updatedAt));

  return (
    <AppShell>
      <JsonLd
        data={[
          countryDatasetJsonLd(country, { officialUrl, count: recs.length, modifiedAt, checkedAt: source?.lastOkAt ?? null }),
          breadcrumbJsonLd([
            { name: "halalfood.world", path: "/" },
            { name: "Halal certifiers", path: "/certifiers" },
            { name: country.name, path: `/certifiers/country/${country.slug}` },
          ]),
        ]}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav active="/certifiers/country/indonesia" />
            <PageTitle sub={`${recs.length} foreign halal certification bodies on ${country.authorityShort}'s official list.`}>
              Halal certifiers recognised for {country.name}
            </PageTitle>
          </div>

          <section aria-labelledby="authority" className="grid max-w-3xl gap-3 text-[15px] leading-relaxed">
            <h2 id="authority" className="sr-only">
              The authority
            </h2>
            <p>
              Halal certification for products sold in {country.name} is run by {country.authorityLong}. {country.authorityShort} publishes the list of
              foreign halal certification bodies (lembaga halal luar negeri) it recognises. A product certified abroad by a body on this list can go
              through {country.authorityShort}&apos;s process for foreign halal certificates; the body must be recognised for the product&apos;s scope.
            </p>
            {source && <CheckedLine url={source.url} checkedAt={source.lastOkAt} label={`${country.authorityShort}'s official list`} />}
            {source?.needsLook && (
              <p className="text-sm font-bold text-warning-strong">Our last check found something odd on the official list, and we are looking at it.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/certifiers/country/${country.slug}.csv`} variant="outline" size="md" download>
                <Icon icon={Download04Icon} size={18} /> Download CSV
              </LinkButton>
              <LinkButton href={officialUrl} variant="outline" size="md" rel="noopener">
                <Icon icon={LinkSquare02Icon} size={18} /> Official list
              </LinkButton>
              {country.guide && (
                <LinkButton href={country.guide.path} variant="ghost" size="md">
                  Import rules guide
                </LinkButton>
              )}
            </div>
          </section>

          <ConfirmNote>
            {`This table copies ${country.authorityShort}'s list so it is easy to search and sort. ${country.authorityShort}'s own list is what counts. "Expired" means the date on the official list has passed; a body may have renewed since.`}
          </ConfirmNote>

          <CertifierTable rows={tableRows(recs, today)} refLabel={`${country.authorityShort} reg. no.`} />

          <section aria-labelledby="changes" className="grid gap-3">
            <SectionTitle id="changes" action={<a href="/certifiers/changes" className="text-sm font-extrabold text-primary underline-offset-4 hover:underline">All changes</a>}>
              Changes to this list
            </SectionTitle>
            {changes.length ? (
              <ul className="grid gap-2">
                {changes.map((change) => (
                  <li key={change.id} className="grid gap-0.5 border-b border-border pb-2 text-sm">
                    <span className="font-bold text-muted-foreground">
                      {formatDay(change.publishedAt)} · {CHANGE_LABEL[change.kind]}
                    </span>
                    <span>
                      <a href={`/certifiers/${change.certifierSlug}`} className="font-extrabold underline-offset-4 hover:underline">
                        {change.certifierName}
                      </a>{" "}
                      {changeSentence(change.kind, change.before, change.after, country.authorityShort)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No changes yet. We first copied this list on 17 Oct 2026, and every change since will show here with the date we saw it.
              </p>
            )}
          </section>
        </div>
      </Page>
    </AppShell>
  );
}
