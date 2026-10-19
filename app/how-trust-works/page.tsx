import type { Metadata } from "next";
import { AppShell } from "@/components/hf/app-shell";
import { Page, PageTitle, SectionTitle, TopBar } from "@/components/hf/kit";

export const metadata: Metadata = {
  title: "How trust works",
  description: "How halalfood.world decides halal facts, badges, trust and points, in plain words.",
  alternates: { canonical: "/how-trust-works" },
};

const facts = [
  ["Muslim-owned", "Is the place owned by Muslims?"],
  ["Halal certified", "Does a halal certifier certify it?"],
  ["Serves pork", "Is pork on the menu?"],
  ["Serves alcohol", "Is alcohol served?"],
];

const badges = [
  ["Creator verified", "A food creator showed the place in a video, and we matched the video to it."],
  ["Community verified", "At least one member who ate there vouched for it. You see who: “Verified by @name and N more”."],
  ["Halal Certified", "Only from a certificate a moderator has reviewed, or a match in an official certifier’s registry. A website saying so is shown as a note, not a badge."],
  ["Muslim owned", "Only from an owner claim we approved with proof. Members saying so shows as “7 people say Muslim-owned”, not a badge."],
  ["Serves alcohol", "A reviewed menu shows alcohol, or checks have settled that it is served."],
  ["Serves pork", "A reviewed menu shows pork, or checks have settled that it is served."],
];

const bands = [
  ["Unverified", "Little or no real-world proof yet. That doesn’t mean it isn’t halal."],
  ["Some proof", "A few people, a creator video or settled facts stand behind it."],
  ["Trusted", "Strong proof, such as a reviewed certificate or many members who agree."],
  ["Highly trusted", "Several kinds of proof that agree: documents, creators and the community."],
];

export default function HowTrustWorksPage() {
  return (
    <AppShell>
      <Page size="content">
        <TopBar back="/" />
        <div className="grid gap-8 pb-8">
          <PageTitle sub="What the labels on a place mean, and what moves them.">How trust works</PageTitle>

          <section className="grid gap-3">
            <SectionTitle>The four halal facts</SectionTitle>
            <p>People who eat somewhere answer four questions about it:</p>
            <dl className="grid gap-2">
              {facts.map(([name, question]) => (
                <div key={name}>
                  <dt className="font-bold">{name}</dt>
                  <dd className="text-muted-foreground">{question}</dd>
                </div>
              ))}
            </dl>
            <p>
              A place is <strong>Confirmed</strong> (shown as Verified on older screens) when three people check it separately and their answers agree, or when a moderator has reviewed documents that settle the facts. Ratings, follows, points and sponsors never change a place’s facts or status.
            </p>
          </section>

          <section className="grid gap-3">
            <SectionTitle>Place badges</SectionTitle>
            <p>A badge shows one kind of proof. Nothing a single member does can make a place Halal Certified or Muslim owned.</p>
            <dl className="grid gap-2">
              {badges.map(([name, rule]) => (
                <div key={name}>
                  <dt className="font-bold">{name}</dt>
                  <dd className="text-muted-foreground">{rule}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="grid gap-3">
            <SectionTitle>Trust</SectionTitle>
            <p>Trust says how much real-world proof stands behind a listing. We show it as words, never just a number:</p>
            <dl className="grid gap-2">
              {bands.map(([name, meaning]) => (
                <div key={name}>
                  <dt className="font-bold">{name}</dt>
                  <dd className="text-muted-foreground">{meaning}</dd>
                </div>
              ))}
            </dl>
            <p>Pork on a reviewed menu keeps a place Unverified and sends it to a moderator for review. Alcohol on a menu adds the Serves alcohol badge but doesn’t change trust.</p>
          </section>

          <section className="grid gap-3">
            <SectionTitle>Points</SectionTitle>
            <ul className="grid list-disc gap-1.5 pl-5">
              <li>You earn points only for contributions we accept, such as a check, a menu or a certificate.</li>
              <li>You can earn at most 100 points a day.</li>
              <li>Points have no cash value.</li>
              <li>Points never affect trust, ranking or a place’s halal status.</li>
            </ul>
          </section>
        </div>
      </Page>
    </AppShell>
  );
}
