import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/hf/app-shell";
import { CertifierDirectory } from "@/components/hf/certifier-directory";
import { CertifiersNav, ConfirmNote, JsonLd } from "@/components/hf/certifier-bits";
import { Page, PageTitle } from "@/components/hf/kit";
import { countryCodeFromSlug, countryName } from "@/lib/certifiers/countries";
import { isoToday } from "@/lib/certifiers/display";
import { IMPORTING_COUNTRIES } from "@/lib/certifiers/importing";
import { aliasesByCertifier, listCurrentRecognitions } from "@/lib/certifiers/repository";
import { sectionTitle } from "@/lib/certifiers/seo";
import { directoryEntries, groupByCertifier } from "@/lib/certifiers/views";
import { breadcrumbJsonLd } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ country: string }> };

const ACCEPTED_BY = IMPORTING_COUNTRIES.map((country) => `${country.name} (${country.authorityShort})`).join(", ");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).country;
  const code = countryCodeFromSlug(slug);
  if (!code) return { title: "Not found", robots: { index: false } };
  const name = countryName(code);
  return {
    title: { absolute: sectionTitle(`Halal certifiers based in ${name} accepted by ${ACCEPTED_BY}`) },
    description: `Halal certification bodies based in ${name} that importing countries' halal authorities recognise, with scopes and valid-until dates from the official lists.`,
    alternates: { canonical: `/certifiers/from/${slug}` },
  };
}

export default async function FromCountryPage({ params }: Props) {
  const slug = (await params).country;
  const code = countryCodeFromSlug(slug);
  if (!code) notFound();
  const [rows, aliases] = await Promise.all([listCurrentRecognitions({ countryCode: code }), aliasesByCertifier()]);
  if (!rows.length) notFound();
  const name = countryName(code)!;
  const groups = groupByCertifier(rows);
  return (
    <AppShell>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "halalfood.world", path: "/" },
          { name: "Halal certifiers", path: "/certifiers" },
          { name: `Based in ${name}`, path: `/certifiers/from/${slug}` },
        ])}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav />
            <PageTitle sub={`${groups.length} ${groups.length === 1 ? "body" : "bodies"} based in ${name} on the official lists of ${ACCEPTED_BY}.`}>
              Halal certifiers based in {name}
            </PageTitle>
          </div>
          <CertifierDirectory
            entries={directoryEntries(groups, aliases, isoToday())}
            columns={IMPORTING_COUNTRIES.map((country) => ({ slug: country.slug, name: country.name, authorityShort: country.authorityShort }))}
            countries={[{ code, name }]}
          />
          <ConfirmNote />
        </div>
      </Page>
    </AppShell>
  );
}
