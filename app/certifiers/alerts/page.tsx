import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppShell } from "@/components/hf/app-shell";
import { CertifiersNav } from "@/components/hf/certifier-bits";
import { Page, PageTitle } from "@/components/hf/kit";
import { IMPORTING_COUNTRIES } from "@/lib/certifiers/importing";
import { certifierSlugParam } from "@/lib/certifiers/names";
import { listCurrentRecognitions } from "@/lib/certifiers/repository";
import { sectionTitle } from "@/lib/certifiers/seo";
import { SCOPE_LABELS } from "@/lib/certifiers/scopes";
import { groupByCertifier } from "@/lib/certifiers/views";
import { readWorkerEnv } from "@/lib/worker-env";
import { AlertsForm } from "./alerts-form";

// The Turnstile site key is a Worker secret, read per request (see app/login/page.tsx).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: sectionTitle("Halal certifier change alerts") },
  description: "Get a weekly note when a halal certification body is added to, removed from or renewed on an importing country's official list.",
  alternates: { canonical: "/certifiers/alerts" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AlertsPage({ searchParams }: Props) {
  const params = await searchParams;
  const wanted = certifierSlugParam(typeof params.certifier === "string" ? params.certifier : null);
  const host = (await headers()).get("host");
  const [rows, siteKey] = await Promise.all([listCurrentRecognitions(), readWorkerEnv("TURNSTILE_SITE_KEY", host)]);
  const certifiers = groupByCertifier(rows).map((group) => ({ slug: group.slug, name: group.name }));
  return (
    <AppShell>
      <Page size="content">
        <div className="grid gap-6">
          <div className="grid gap-4">
            <CertifiersNav active="/certifiers/alerts" />
            <PageTitle sub="A weekly note of what changed on the official lists you care about: bodies added, removed, renewed or renamed.">
              Certifier change alerts
            </PageTitle>
          </div>
          <AlertsForm
            siteKey={siteKey}
            countries={IMPORTING_COUNTRIES.map((country) => ({ id: country.authorityId, label: `${country.name} (${country.authorityShort})` }))}
            certifiers={certifiers}
            scopes={Object.entries(SCOPE_LABELS).map(([code, label]) => ({ code, label }))}
            initialCertifier={certifiers.some((each) => each.slug === wanted) ? wanted : null}
          />
          <p className="text-sm text-muted-foreground">
            We are collecting sign-ups now and will email you once to confirm before anything is sent. Your address is used for these alerts only, and every
            email will have a one-click unsubscribe. Until then, the{" "}
            <a href="/certifiers/changes" className="font-bold underline underline-offset-4">
              change log
            </a>{" "}
            and its{" "}
            <a href="/certifiers/changes.xml" className="font-bold underline underline-offset-4">
              feed
            </a>{" "}
            show every change.
          </p>
        </div>
      </Page>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer />
    </AppShell>
  );
}
