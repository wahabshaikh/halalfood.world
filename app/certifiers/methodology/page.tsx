import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { CertifiersNav, JsonLd, Prose } from "@/components/hf/certifier-bits";
import { Page, PageTitle } from "@/components/hf/kit";
import { BPJPH_LIST_URL } from "@/lib/certifiers/bpjph";
import { CHECK_USER_AGENT, PAGE_DELAY_MS } from "@/lib/certifiers/check";
import { MAX_ROW_DROP } from "@/lib/certifiers/diff";
import { sectionTitle } from "@/lib/certifiers/seo";
import { breadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: sectionTitle("How we check halal certifier lists: methodology") },
  description: "Where the halal certifier directory's data comes from, how often we check the official lists, how we match names, and how to report an error.",
  alternates: { canonical: "/certifiers/methodology" },
};

export default function MethodologyPage() {
  return (
    <AppShell>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "halalfood.world", path: "/" },
          { name: "Halal certifiers", path: "/certifiers" },
          { name: "Methodology", path: "/certifiers/methodology" },
        ])}
      />
      <Page>
        <div className="grid gap-6 md:gap-8">
          <div className="grid gap-4">
            <CertifiersNav active="/certifiers/methodology" />
            <PageTitle sub="Where every entry comes from, and what we do and do not claim.">Methodology</PageTitle>
          </div>
          <Prose>
            <h2>Only official lists</h2>
            <p>
              A certifier&apos;s status here comes from one place: the list published by the importing country&apos;s halal authority. For Indonesia that is
              BPJPH&apos;s list of recognised foreign halal certification bodies at <a href={BPJPH_LIST_URL}>bpjph.halal.go.id</a>. Every entry links to that
              list and shows the date we last checked it. We do not use certifiers&apos; own websites, consultants&apos; pages or news to decide whether a body
              is recognised; at most they tell us where to look.
            </p>
            <p>
              We copy what the list says and nothing more: the name as written, where the body is based, its address, the product scopes in the
              list&apos;s own words, the valid-until date and the registration number. Where the list gives no date or number, we say so rather than fill
              the gap. We do not add websites or contact details that the official list does not give.
            </p>

            <h2>How often we check</h2>
            <p>
              We re-read each official list on a schedule, aiming for once a day, and whenever a moderator asks for a check. Our checker identifies
              itself as <code className="text-sm">{CHECK_USER_AGENT}</code>, reads one page at a time with a {PAGE_DELAY_MS / 1000}-second pause between
              pages, and keeps a copy of every page it read, so each entry can be traced back to what the authority published on a given day.
            </p>

            <h2>What counts as a change</h2>
            <ul>
              <li>A body added to or removed from the list.</li>
              <li>A product scope added or removed.</li>
              <li>A new valid-until date.</li>
              <li>A body renamed. Old addresses of its page keep working.</li>
            </ul>
            <p>
              A later valid-until date and a newly added scope are published as soon as we see them. Removals, new bodies, renames, removed scopes and
              earlier dates are checked by a person first. If a check finds more than {MAX_ROW_DROP * 100}% fewer bodies than before, we treat it as a
              problem with the page rather than a policy change: no one is removed, and we look into it.
            </p>

            <h2>Expired dates</h2>
            <p>
              A body is shown as expired when the valid-until date on the official list has passed, even if the authority still lists it. We call it
              &quot;expired on the official list&apos;s own date&quot; because the body may have renewed and the list may not have caught up. Check with the
              authority.
            </p>

            <h2>How we match names</h2>
            <p>
              Lists spell the same body in different ways. To match them we ignore case, accents, punctuation, bracketed abbreviations and legal forms
              such as &quot;Pty Ltd&quot;, &quot;Inc.&quot; or &quot;GmbH&quot; at the end of a name. Where a list gives each body its own id, as BPJPH does, we
              match on that id first. Each page shows the name as the official list writes it.
            </p>

            <h2>What this is not</h2>
            <p>
              This directory is not legal or regulatory advice, and it is not a halal certification. Recognition rules, scopes and procedures belong to
              each authority and can change. Always confirm with the authority before shipping.
            </p>

            <h2>Report an error</h2>
            <p>
              If something here does not match the official list, email <a href="mailto:salam@halalfood.world">salam@halalfood.world</a> with the page
              and what the list says. We re-check the official source and correct our copy if it differs. If you are a certification body and the
              official list is wrong about you, the authority is the one who can change it.
            </p>
          </Prose>
        </div>
      </Page>
    </AppShell>
  );
}
