import type { Metadata } from "next";
import { AppShell } from "../src/components/app-shell";
import { EmptyState, LinkButton } from "../src/components/kit";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <AppShell>
      <EmptyState
        title="We couldn’t find that page"
        body="The place may have moved, or the link might have a typo."
        action={
          <LinkButton href="/" className="mt-2">
            Start exploring
          </LinkButton>
        }
      />
    </AppShell>
  );
}
