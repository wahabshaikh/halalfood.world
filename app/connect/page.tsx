import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, SectionTitle } from "@/components/hf/kit";

const mcpUrl = "https://halalfood.world/api/mcp/member";

export const metadata: Metadata = {
  title: "Connect your AI",
  description: "Use halalfood.world from Claude, ChatGPT or Cursor.",
  robots: { index: false },
  alternates: { canonical: "/connect" },
};

export default function ConnectPage() {
  return (
    <AppShell>
      <Page size="content" className="grid gap-8 pb-8">
        <PageTitle sub="Use halalfood.world from Claude, ChatGPT or Cursor">Connect your AI</PageTitle>

        <section className="grid gap-3">
          <SectionTitle>What you can do today</SectionTitle>
          <p>Search places and get a place’s halal facts through our public, read-only member MCP endpoint. No account is needed.</p>
          <code className="break-all rounded-xl bg-secondary p-4 text-sm">{mcpUrl}</code>
        </section>

        <section className="grid gap-3">
          <SectionTitle>Coming next</SectionTitle>
          <p>Submit places, videos and verifications under your account, using your own AI so we can keep costs low. Submissions through AI are not available yet.</p>
        </section>

        <section className="grid gap-3">
          <SectionTitle>Claude</SectionTitle>
          <p>Open Settings &gt; Connectors &gt; Add custom connector. Name it halalfood and paste this URL:</p>
          <code className="break-all text-sm">{mcpUrl}</code>
        </section>

        <section className="grid gap-3">
          <SectionTitle>Cursor</SectionTitle>
          <p>Add this to <code>~/.cursor/mcp.json</code>, keeping any existing servers:</p>
          <pre className="min-w-0 overflow-x-auto rounded-xl bg-secondary p-4 text-sm">
            <code>{JSON.stringify({ mcpServers: { halalfood: { url: mcpUrl } } }, null, 2)}</code>
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
