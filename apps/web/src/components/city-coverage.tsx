"use client";

import { useState } from "react";
import { COVERAGE_COPY, type CityCoverage } from "@halalfood/core/coverage";
import { Button } from "@halalfood/ui/components/button";
import { Card } from "@halalfood/ui/components/card";
import { Checkbox } from "@halalfood/ui/components/checkbox";
import { Field, FieldLabel } from "@halalfood/ui/components/field";
import { Progress } from "@halalfood/ui/components/progress";
import { cn } from "@halalfood/ui/lib/utils";
import { Note, SectionHeading } from "./section";

/**
 * A city's honest coverage, plus the action a visitor from a thin city needs.
 *
 * The launch assumption is that traffic arrives from everywhere at once. A
 * "coming soon" page throws that away; this shows exactly how much is indexed
 * and turns the disappointment into a demand signal and a contributor lead.
 */
export default function CityCoverageCard({
  coverage,
  headline,
}: {
  coverage: CityCoverage;
  headline: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [wantsToContribute, setWantsToContribute] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const levels = [
    { key: "indexed", count: coverage.indexed },
    { key: "enriched", count: coverage.enriched },
    { key: "intelligent", count: coverage.intelligent },
    { key: "trusted", count: coverage.trusted },
  ] as const;

  async function request() {
    setState("sending");
    try {
      const response = await fetch(
        `/api/cities/${encodeURIComponent(coverage.citySlug)}/coverage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wantsToContribute }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState("error");
        setMessage(typeof body.error === "string" ? body.error : "That did not work.");
        return;
      }
      setState("sent");
      setMessage(
        body.created === false
          ? "You have already asked for this city — it is counted."
          : wantsToContribute
            ? "Counted, and noted that you would help build it."
            : "Counted. Cities with the most requests get enriched first.",
      );
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }

  return (
    <section className="my-6" aria-labelledby="city-coverage-title">
      <Card className="gap-0 px-5 py-5">
        <SectionHeading
          id="city-coverage-title"
          eyebrow="HOW MUCH OF THIS CITY WE ACTUALLY HAVE"
          title="Coverage"
        />

        <p className="mb-3 text-base font-semibold">{headline}</p>

        <Progress
          value={coverage.enrichedPercent}
          className="mb-4 h-2"
          role="img"
          aria-label={`${coverage.enrichedPercent}% of listed places have attached evidence`}
        />

        <ul className="mb-4.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {levels.map((level) => (
            <li key={level.key} className="rounded-xl border bg-muted p-3">
              <strong className="block text-xl tracking-tight">{level.count.toLocaleString()}</strong>
              <span className="block text-[13px] font-semibold">
                {COVERAGE_COPY[level.key].label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {COVERAGE_COPY[level.key].meaning}
              </span>
            </li>
          ))}
        </ul>

        <div className="grid justify-items-start gap-2.5">
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id="coverage-contribute"
              checked={wantsToContribute}
              onCheckedChange={(checked) => setWantsToContribute(checked === true)}
            />
            <FieldLabel htmlFor="coverage-contribute" className="font-normal">
              I would help build coverage here.
            </FieldLabel>
          </Field>
          <Button
            size="lg"
            disabled={state === "sending" || state === "sent"}
            onClick={() => void request()}
          >
            {state === "sending"
              ? "Sending…"
              : state === "sent"
                ? "Request counted"
                : "Ask for deeper coverage here"}
          </Button>
          {coverage.requests > 0 && (
            <Note>
              {coverage.requests.toLocaleString()}{" "}
              {coverage.requests === 1 ? "person has" : "people have"} asked for
              this city
              {coverage.contributors > 0
                ? `, ${coverage.contributors} offering to help`
                : ""}
              .
            </Note>
          )}
          {message && (
            <p
              className={cn("text-sm", state === "error" ? "text-destructive" : "text-success")}
              role="status"
            >
              {message}
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}
