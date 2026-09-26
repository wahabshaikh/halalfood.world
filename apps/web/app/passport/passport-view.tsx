"use client";

import { useEffect, useState } from "react";
import { Card } from "@halalfood/ui/components/card";
import { Progress } from "@halalfood/ui/components/progress";
import { cn } from "@halalfood/ui/lib/utils";
import { Block, Loading, RowList, StatGrid, StatTile } from "../../src/components/blocks";
import { FormMessage, InsufficientData, SectionIntro } from "../../src/components/section";

import type { FoodPassport, Milestone } from "@halalfood/core/food-passport";
import type { VisitedPlaceSummary } from "../../src/lib/visits";
import ShareButton from "../../src/components/share-button";

/**
 * The food passport: coverage, milestones and a personal food map.
 *
 * Verified and self-reported visits are shown as two numbers rather than one,
 * and every milestone rewards diversity, revisits or useful evidence — nothing
 * here counts raw review volume.
 */

type Payload = {
  passport: FoodPassport;
  milestones: Milestone[];
  places: VisitedPlaceSummary[];
};

function Coverage({
  title,
  buckets,
}: {
  title: string;
  buckets: FoodPassport["cities"];
}) {
  if (!buckets.length) return null;
  return (
    <Block title={title}>
      <RowList className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-6">
        {buckets.slice(0, 12).map((bucket) => (
          <li key={bucket.key}>
            <span>{bucket.label}</span>
            <span className="text-[13px] text-muted-foreground">
              {bucket.places} {bucket.places === 1 ? "place" : "places"}
            </span>
          </li>
        ))}
      </RowList>
    </Block>
  );
}

export default function PassportView() {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/passport");
        if (response.status === 401) {
          const body = await response.json();
          if (typeof body.loginUrl === "string") window.location.href = body.loginUrl;
          return;
        }
        if (!response.ok) throw new Error();
        setData((await response.json()) as Payload);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, []);

  if (state === "loading") return <Loading>Loading your passport…</Loading>;
  if (state === "error" || !data)
    return <FormMessage tone="error">Your passport could not load. Please try again.</FormMessage>;

  const { passport, milestones, places } = data;
  const empty = passport.verifiedVisits + passport.unverifiedVisits === 0;

  return (
    <div>
      <StatGrid>
        <StatTile value={passport.verifiedVisits} label="Verified visits" />
        <StatTile value={passport.unverifiedVisits} label="Self-reported visits" />
        <StatTile value={passport.distinctPlaces} label="Places" />
        <StatTile value={passport.cities.length} label="Cities" />
        <StatTile value={passport.revisits} label="Places revisited" />
      </StatGrid>

      {empty ? (
        <InsufficientData>
          Your passport fills up as you record visits. Open any restaurant and
          check in — it takes about ten seconds.
        </InsufficientData>
      ) : (
        <>
          <Coverage title="Cities" buckets={passport.cities} />
          <Coverage title="Neighbourhoods" buckets={passport.neighbourhoods} />
          <Coverage title="Cuisines" buckets={passport.cuisines} />
          <Coverage title="Countries" buckets={passport.countries} />

          <Block title="Milestones">
            <SectionIntro>
              These reward exploring widely, going back, and keeping evidence
              fresh. None of them count how much you have written.
            </SectionIntro>
            <ul className="grid gap-3.5">
              {milestones.map((milestone) => (
                <li key={milestone.key}>
                  <Card
                    size="sm"
                    className={cn(
                      "gap-1 px-3.5",
                      milestone.achieved && "bg-success-muted ring-success",
                    )}
                  >
                    <div className="flex justify-between gap-2.5 text-sm">
                      <strong>{milestone.label}</strong>
                      <span>
                        {milestone.progress} / {milestone.target}
                      </span>
                    </div>
                    <p className="mb-2 text-[13px] text-muted-foreground">{milestone.description}</p>
                    <Progress
                      className="h-1.5"
                      value={Math.round((milestone.progress / milestone.target) * 100)}
                      aria-valuenow={milestone.progress}
                      aria-valuemin={0}
                      aria-valuemax={milestone.target}
                    />
                  </Card>
                </li>
              ))}
            </ul>
          </Block>

          <Block
            title="Your food map"
            action={
              <ShareButton
                url="/passport"
                title="My halal food map"
                text={`${passport.distinctPlaces} places across ${passport.cities.length} cities`}
                variant="outline"
              />
            }
          >
            <RowList>
              {places.map((place) => (
                <li key={place.placeId}>
                  <a href={`/place/${place.placeId}`} className="font-semibold hover:underline">
                    {place.name}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {place.visits > 1 ? `${place.visits} visits · ` : ""}
                    {place.wouldReturn === "definitely"
                      ? "Would definitely return"
                      : place.wouldReturn === "maybe"
                        ? "Would maybe return"
                        : place.wouldReturn === "no"
                          ? "Would not return"
                          : "No verdict recorded"}
                  </span>
                </li>
              ))}
            </RowList>
          </Block>
        </>
      )}
    </div>
  );
}
