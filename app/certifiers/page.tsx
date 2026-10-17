import type { Metadata } from "next";
import { ArrowRight01Icon, Notification03Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "@/components/hf/app-shell";
import { CertifierDirectory } from "@/components/hf/certifier-directory";
import { CertifiersNav, CheckedLine, ConfirmNote, JsonLd } from "@/components/hf/certifier-bits";
import { Icon, LinkButton, Page, PageTitle, SectionTitle } from "@/components/hf/kit";
import { countrySlug } from "@/lib/certifiers/countries";
import { isoToday } from "@/lib/certifiers/display";
import { IMPORTING_COUNTRIES } from "@/lib/certifiers/importing";
import { aliasesByCertifier, listCurrentRecognitions, listSources } from "@/lib/certifiers/repository";
import { hubTitle } from "@/lib/certifiers/seo";
import { basedInCountries, directoryEntries, groupByCertifier } from "@/lib/certifiers/views";
import { breadcrumbJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Check whether your halal certifier is accepted by an importing country's halal authority. Every entry is copied from the official list, with its scopes, expiry date and the date we last checked.";

export async function generateMetadata(): Promise<Metadata> {
  const sources = await listSources().catch(() => []);
  const checkedAt = Math.max(0, ...sources.map((source) => source.lastOkAt ?? 0)) || null;
  return {
    title: { absolute: hubTitle(checkedAt) },
    description: DESCRIPTION,
    alternates: { canonical: "/certifiers", types: { "application/atom+xml": "/certifiers/changes.xml" } },
  };
}

export default async function CertifiersHub() {
  const [rows, sources, aliases] = await Promise.all([listCurrentRecognitions(), listSources(), aliasesByCertifier()]);
  const today = isoToday();
  const groups = groupByCertifier(rows);
  const based = basedInCountries(groups);
  return (
    <AppShell>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "halalfood.world", path: "/" },
          { name: "Halal certifiers", path: "/certifiers" },
        ])}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav active="/certifiers" />
            <PageTitle sub="For exporters: is your halal certifier accepted where you ship? Copied from each importing country's official list, with the date we last checked it.">
              Halal certification bodies
            </PageTitle>
          </div>

          <CertifierDirectory
            entries={directoryEntries(groups, aliases, today)}
            columns={IMPORTING_COUNTRIES.map((country) => ({ slug: country.slug, name: country.name, authorityShort: country.authorityShort }))}
            countries={based.map(({ code, name }) => ({ code, name }))}
          />

          <ConfirmNote />

          <section aria-labelledby="sources" className="grid gap-3">
            <SectionTitle id="sources">Official lists we check</SectionTitle>
            <ul className="grid gap-3 md:grid-cols-2">
              {IMPORTING_COUNTRIES.map((country) => {
                const source = sources.find((each) => each.id === country.sourceId);
                const count = rows.filter((row) => row.authorityId === country.authorityId).length;
                return (
                  <li key={country.slug} className="grid gap-2 rounded-2xl border border-border p-4">
                    <a href={`/certifiers/country/${country.slug}`} className="inline-flex items-center gap-1 text-[17px] font-black underline-offset-4 hover:underline">
                      {country.name}: {country.authorityShort}, {count} bodies
                      <Icon icon={ArrowRight01Icon} size={18} />
                    </a>
                    {source && <CheckedLine url={source.url} checkedAt={source.lastOkAt} label={`${country.authorityShort}'s official list`} />}
                    {source?.needsLook && <p className="text-sm font-bold text-warning-strong">The last check found something odd, and we are looking at it. The official list is what counts.</p>}
                    {country.guide && (
                      <a href={country.guide.path} className="text-sm font-extrabold text-primary underline-offset-4 hover:underline">
                        {country.guide.title}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-muted-foreground">
              Malaysia (JAKIM), the UAE (MOIAT) and the Gulf (GAC) come next, once we can check their lists the same way.
            </p>
          </section>

          <section aria-labelledby="based" className="grid gap-3">
            <SectionTitle id="based">Certifiers by where they are based</SectionTitle>
            <ul className="flex flex-wrap gap-2">
              {based.map((country) => (
                <li key={country.code}>
                  <a
                    href={`/certifiers/from/${countrySlug(country.code)}`}
                    className="inline-flex min-h-10 items-center rounded-full bg-secondary px-3.5 text-sm font-extrabold hover:bg-secondary/70"
                  >
                    {country.name} · {country.count}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3 rounded-2xl bg-accent p-5 md:grid-cols-[1fr_auto] md:items-center">
            <div className="grid gap-1">
              <h2 className="text-lg font-black">Know when a list changes</h2>
              <p className="text-sm font-semibold text-subtle-foreground">
                Bodies are added, removed and renewed. Sign up for a weekly note of what changed, or follow the{" "}
                <a href="/certifiers/changes" className="font-extrabold underline underline-offset-4">
                  change log
                </a>
                .
              </p>
            </div>
            <LinkButton href="/certifiers/alerts" variant="dark" size="md">
              <Icon icon={Notification03Icon} size={18} /> Get alerts
            </LinkButton>
          </section>
        </div>
      </Page>
    </AppShell>
  );
}
