import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { CertifiersNav, ConfirmNote, JsonLd, Prose } from "@/components/hf/certifier-bits";
import { Page, PageTitle } from "@/components/hf/kit";
import { BPJPH_LIST_URL } from "@/lib/certifiers/bpjph";
import { sectionTitle } from "@/lib/certifiers/seo";
import { breadcrumbJsonLd, canonical, SITE_NAME, SITE_URL } from "@/lib/seo";

const PATH = "/certifiers/guides/indonesia-halal-import-rules-2026";
const TITLE = "Indonesia halal import rules 2026: what exporters should know";
const PUBLISHED = "2026-10-17";

export const metadata: Metadata = {
  title: { absolute: sectionTitle(TITLE) },
  description:
    "From 17 October 2026, Indonesia's halal certification obligation reaches imported products. What that means for exporters, and how to check your certifier is recognised by BPJPH.",
  alternates: { canonical: PATH },
};

export default function IndonesiaGuide() {
  return (
    <AppShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: TITLE,
            datePublished: PUBLISHED,
            dateModified: PUBLISHED,
            mainEntityOfPage: canonical(PATH),
            author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
          },
          breadcrumbJsonLd([
            { name: "halalfood.world", path: "/" },
            { name: "Halal certifiers", path: "/certifiers" },
            { name: "Indonesia halal import rules 2026", path: PATH },
          ]),
        ]}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav />
            <PageTitle sub="Published 17 Oct 2026. A short guide, not legal advice.">{TITLE}</PageTitle>
          </div>
          <Prose>
            <h2>What changes on 17 October 2026</h2>
            <p>
              Indonesia&apos;s Halal Product Assurance law (Law No. 33 of 2014) makes halal certification mandatory for products that enter, circulate
              and are traded in Indonesia, brought in in stages. 17 October 2026 is the date the obligation reaches products made abroad and imported
              into Indonesia. Halal certification is run by BPJPH (Badan Penyelenggara Jaminan Produk Halal), Indonesia&apos;s Halal Product Assurance
              Organizing Agency.
            </p>
            <p>
              Which products are covered, the exact steps and any exceptions are set by BPJPH and Indonesian regulations, and they can change. Read
              them on <a href="https://bpjph.halal.go.id">bpjph.halal.go.id</a> before you rely on anything here.
            </p>

            <h2>Certified abroad: is your certifier recognised?</h2>
            <p>
              BPJPH publishes a list of the foreign halal certification bodies it recognises. If your product is certified by a body abroad, check that
              the body is on that list, that it is recognised for your product&apos;s scope (food, beverages, cosmetics, slaughtering and so on), and that
              its valid-until date has not passed. We keep a searchable copy of{" "}
              <a href="/certifiers/country/indonesia">BPJPH&apos;s list of recognised foreign halal certification bodies</a>, checked against the{" "}
              <a href={BPJPH_LIST_URL}>official list</a>.
            </p>

            <h2>A short checklist for exporters</h2>
            <ol>
              <li>Find your certifier on BPJPH&apos;s list.</li>
              <li>Check the scopes it is recognised for cover your product.</li>
              <li>Check its valid-until date, and when your own certificate expires.</li>
              <li>Ask your Indonesian importer what BPJPH needs for a foreign halal certificate, and how long it takes.</li>
              <li>Confirm the current rules with BPJPH before you ship.</li>
            </ol>
            <p>
              To hear when a body is added, removed or renewed, <a href="/certifiers/alerts">sign up for alerts</a> or follow the{" "}
              <a href="/certifiers/changes">change log</a>.
            </p>
          </Prose>
          <ConfirmNote>This guide is a plain summary to help you ask the right questions. It is not legal advice, and BPJPH&apos;s rules are what count.</ConfirmNote>
        </div>
      </Page>
    </AppShell>
  );
}
