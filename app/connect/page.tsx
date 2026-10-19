import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, SectionTitle } from "@/components/hf/kit";

const mcpUrl = "https://halalfood.world/api/mcp/member";

export const metadata: Metadata = {
  title: "Connect your AI",
  description: "Use halalfood.world from Claude, ChatGPT or Cursor.",
  alternates: { canonical: "/connect" },
};

export default function ConnectPage() {
  return (
    <AppShell>
      <Page size="content" className="grid gap-8 pb-8">
        <PageTitle sub="Use halalfood.world from Claude, ChatGPT or Cursor">Connect your AI</PageTitle>

        <section className="grid gap-3">
          <SectionTitle>What you can do today</SectionTitle>
          <p>Search places and get a place’s halal facts without an account. With a member key, your AI can also vouch for places you ate at, update your vouch ratings and see your contributions.</p>
          <code className="break-all rounded-xl bg-secondary p-4 text-sm">{mcpUrl}</code>
        </section>

        <section className="grid gap-3">
          <SectionTitle>Contribute with your member key</SectionTitle>
          <p><Link href="/me/keys" className="underline">Create a member key</Link> with read and write scope once your account is 7 days old. In clients that support custom headers, send <code>Authorization: Bearer &lt;member key&gt;</code>. Keep your key private; you can revoke it at any time.</p>
          <p>Your AI contributions use the same daily limits, points and review as the website. Vouch ratings earn no points. Place and video submissions through AI are not available yet.</p>
          <p>Only submit what you saw or data from the restaurant’s own or open public pages. Never scrape Zomato, Swiggy or Google Maps.</p>
        </section>

        <section className="grid gap-3">
          <SectionTitle>Claude</SectionTitle>
          <p>Open Settings &gt; Connectors &gt; Add custom connector. Name it halalfood and paste this URL:</p>
          <code className="break-all text-sm">{mcpUrl}</code>
        </section>

        <section className="grid gap-3">
          <SectionTitle>Cursor</SectionTitle>
          <p>Add this to <code>~/.cursor/mcp.json</code>, keeping any existing servers. For member tools, replace the placeholder with your key; omit the headers for public reads:</p>
          <pre className="min-w-0 overflow-x-auto rounded-xl bg-secondary p-4 text-sm">
            <code>{JSON.stringify({ mcpServers: { halalfood: { url: mcpUrl, headers: { Authorization: "Bearer <member key>" } } } }, null, 2)}</code>
          </pre>
        </section>

        <section className="grid gap-3">
          <SectionTitle>ChatGPT</SectionTitle>
          <p>Enable developer mode in connector settings, then create a connector named halalfood with this URL:</p>
          <code className="break-all text-sm">{mcpUrl}</code>
        </section>
      </Page>
    </AppShell>
  );
}
