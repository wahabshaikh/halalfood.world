import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { LinkSquare02Icon, Notification03Icon } from "@hugeicons/core-free-icons";
import { AppShell } from "@/components/hf/app-shell";
import { CertStatusPill, CertifiersNav, ConfirmNote, JsonLd, ScopeList } from "@/components/hf/certifier-bits";
import { Icon, LinkButton, Page, PageTitle, SectionTitle } from "@/components/hf/kit";
import { countryName, countrySlug } from "@/lib/certifiers/countries";
import { CHANGE_LABEL, changeSentence, displayStatus, formatDay, isoToday, validUntilText } from "@/lib/certifiers/display";
import { importingCountryForAuthority } from "@/lib/certifiers/importing";
import { certifierSlugParam } from "@/lib/certifiers/names";
import { getCertifierBySlug, listSources } from "@/lib/certifiers/repository";
import { certifierJsonLd, certifierTitle } from "@/lib/certifiers/seo";
import { basedIn } from "@/lib/certifiers/views";
import { breadcrumbJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const authorityShort = (id: string) => importingCountryForAuthority(id)?.authorityShort ?? id.toUpperCase();

async function load(raw: string) {
  const slug = certifierSlugParam(raw);
  return slug ? getCertifierBySlug(slug) : ({ kind: "missing" } as const);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await load((await params).slug).catch(() => null);
  if (!page || page.kind !== "found") return { title: "Certifier not found", robots: { index: false } };
  const { certifier } = page;
  const where = basedIn(certifier.city, certifier.countryCode);
  return {
    title: { absolute: certifierTitle(certifier.name, certifier.recognitions, authorityShort) },
    description: `${certifier.name}, based in ${where}: which importing countries' halal authorities recognise it, for which product scopes and until when, checked against the official lists.`,
    alternates: { canonical: `/certifiers/${certifier.slug}` },
  };
}

export default async function CertifierPage({ params }: Props) {
  const page = await load((await params).slug);
  if (page.kind === "moved") permanentRedirect(`/certifiers/${page.slug}`);
  if (page.kind !== "found") notFound();
  const { certifier } = page;
  const sources = await listSources();
  const today = isoToday();
  const country = countryName(certifier.countryCode);
  const fromSlug = certifier.countryCode ? countrySlug(certifier.countryCode) : null;

  return (
    <AppShell>
      <JsonLd
        data={[
          certifierJsonLd(certifier),
          breadcrumbJsonLd([
            { name: "halalfood.world", path: "/" },
            { name: "Halal certifiers", path: "/certifiers" },
            { name: certifier.name, path: `/certifiers/${certifier.slug}` },
          ]),
        ]}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav />
            <PageTitle
              sub={
                <>
                  Halal certification body based in{" "}
                  {certifier.city ? `${certifier.city}, ` : ""}
                  {fromSlug && country ? (
                    <a href={`/certifiers/from/${fromSlug}`} className="font-extrabold underline underline-offset-4">
                      {country}
                    </a>
                  ) : (
                    (country ?? "a country the official list does not name")
                  )}
                </>
              }
            >
              {certifier.name}
            </PageTitle>
            {certifier.address && (
              <p className="max-w-3xl text-sm text-subtle-foreground">
                <span className="font-extrabold text-foreground">Address on the official list:</span> {certifier.address}
              </p>
            )}
          </div>

          <section aria-labelledby="recognitions" className="grid gap-3">
            <SectionTitle id="recognitions">Recognised by importing countries</SectionTitle>
            <ul className="grid gap-3 md:grid-cols-2">
              {certifier.recognitions.map((rec) => {
                const importing = importingCountryForAuthority(rec.authorityId);
                const source = sources.find((each) => each.authorityId === rec.authorityId);
                const status = displayStatus(rec.status, rec.validUntil, today);
                return (
                  <li key={rec.recognitionId} className="grid gap-3 rounded-2xl border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a href={importing ? `/certifiers/country/${importing.slug}` : "/certifiers"} className="text-[17px] font-black underline-offset-4 hover:underline">
                        {importing?.name ?? rec.authorityId} ({authorityShort(rec.authorityId)})
                      </a>
                      <CertStatusPill status={status} />
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                      <dt className="font-extrabold">Valid until</dt>
                      <dd className={rec.validUntil ? "font-bold" : "text-muted-foreground"}>{validUntilText(rec.validUntil, today)}</dd>
                      <dt className="font-extrabold">Scopes</dt>
                      <dd>
                        <ScopeList scopes={rec.scopes} raw={rec.scopesRaw} />
                      </dd>
                      {rec.scopesRaw && (
                        <>
                          <dt className="font-extrabold">Official wording</dt>
                          <dd className="text-subtle-foreground">{rec.scopesRaw.split("|").join(", ")}</dd>
                        </>
                      )}
                      <dt className="font-extrabold">{authorityShort(rec.authorityId)} reg. no.</dt>
                      <dd className={rec.sourceRef ? "font-mono text-xs break-all" : "text-muted-foreground"}>{rec.sourceRef ?? "Not given on the official list"}</dd>
                      {rec.sourceStatus && (
                        <>
                          <dt className="font-extrabold">Listed as</dt>
                          <dd>
                            {rec.sourceStatus}
                            {rec.sourceStatus === "MRA" && <span className="text-subtle-foreground"> (mutual recognition agreement)</span>}
                          </dd>
                        </>
                      )}
                      <dt className="font-extrabold">Last checked</dt>
                      <dd>{formatDay(rec.lastCheckedAt)}</dd>
                    </dl>
                    {source && (
                      <a href={source.url} rel="noopener" className="inline-flex items-center gap-1 text-sm font-extrabold text-primary underline-offset-4 hover:underline">
                        See the official list <Icon icon={LinkSquare02Icon} size={14} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <ConfirmNote />

          <section aria-labelledby="history" className="grid gap-3">
            <SectionTitle id="history">Change history</SectionTitle>
            {certifier.changes.length ? (
              <ul className="grid gap-2">
                {certifier.changes.map((change) => (
                  <li key={change.id} className="grid gap-0.5 border-b border-border pb-2 text-sm">
                    <span className="font-bold text-muted-foreground">
                      {formatDay(change.publishedAt)} · {CHANGE_LABEL[change.kind]} · {authorityShort(change.authorityId)}
                    </span>
                    <span>{changeSentence(change.kind, change.before, change.after, authorityShort(change.authorityId))}</span>
                    {change.sourceUrl && change.snapshotFetchedAt && (
                      <span className="text-xs text-muted-foreground">
                        Seen on the{" "}
                        <a href={change.sourceUrl} rel="noopener" className="underline underline-offset-4">
                          official list
                        </a>{" "}
                        on {formatDay(change.snapshotFetchedAt)}.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No changes since we first copied the official lists on 17 Oct 2026.</p>
            )}
          </section>

          <div>
            <LinkButton href={`/certifiers/alerts?certifier=${certifier.slug}`} variant="dark" size="md">
              <Icon icon={Notification03Icon} size={18} /> Get alerts for this certifier
            </LinkButton>
          </div>
        </div>
      </Page>
    </AppShell>
  );
}
