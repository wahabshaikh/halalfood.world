"use client";

import { useEffect, useState } from "react";
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
    <section className="coverage-block">
      <h2>{title}</h2>
      <ul className="coverage-list">
        {buckets.slice(0, 12).map((bucket) => (
          <li key={bucket.key}>
            <span className="coverage-label">{bucket.label}</span>
            <span className="coverage-count">
              {bucket.places} {bucket.places === 1 ? "place" : "places"}
            </span>
          </li>
        ))}
      </ul>
    </section>
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

  if (state === "loading") return <p className="map-place-status">Loading your passport…</p>;
  if (state === "error" || !data)
    return <p className="map-place-status">Your passport could not load. Please try again.</p>;

  const { passport, milestones, places } = data;
  const empty = passport.verifiedVisits + passport.unverifiedVisits === 0;

  return (
    <div className="passport">
      <section className="passport-stats">
        <div className="passport-stat">
          <strong>{passport.verifiedVisits}</strong>
          <span>Verified visits</span>
        </div>
        <div className="passport-stat">
          <strong>{passport.unverifiedVisits}</strong>
          <span>Self-reported visits</span>
        </div>
        <div className="passport-stat">
          <strong>{passport.distinctPlaces}</strong>
          <span>Places</span>
        </div>
        <div className="passport-stat">
          <strong>{passport.cities.length}</strong>
          <span>Cities</span>
        </div>
        <div className="passport-stat">
          <strong>{passport.revisits}</strong>
          <span>Places revisited</span>
        </div>
      </section>

      {empty ? (
        <p className="insufficient-data">
          Your passport fills up as you record visits. Open any restaurant and
          check in — it takes about ten seconds.
        </p>
      ) : (
        <>
          <Coverage title="Cities" buckets={passport.cities} />
          <Coverage title="Neighbourhoods" buckets={passport.neighbourhoods} />
          <Coverage title="Cuisines" buckets={passport.cuisines} />
          <Coverage title="Countries" buckets={passport.countries} />

          <section className="coverage-block">
            <h2>Milestones</h2>
            <p className="section-intro">
              These reward exploring widely, going back, and keeping evidence
              fresh. None of them count how much you have written.
            </p>
            <ul className="milestone-list">
              {milestones.map((milestone) => (
                <li
                  key={milestone.key}
                  className={`milestone${milestone.achieved ? " is-achieved" : ""}`}
                >
                  <div className="milestone-head">
                    <strong>{milestone.label}</strong>
                    <span>
                      {milestone.progress} / {milestone.target}
                    </span>
                  </div>
                  <p>{milestone.description}</p>
                  <div
                    className="milestone-bar"
                    role="progressbar"
                    aria-valuenow={milestone.progress}
                    aria-valuemin={0}
                    aria-valuemax={milestone.target}
                  >
                    <span
                      style={{
                        width: `${Math.round((milestone.progress / milestone.target) * 100)}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="coverage-block">
            <div className="place-section-heading">
              <div>
                <h2>Your food map</h2>
              </div>
              <ShareButton
                url="/passport"
                title="My halal food map"
                text={`${passport.distinctPlaces} places across ${passport.cities.length} cities`}
                variant="outline"
              />
            </div>
            <ul className="visited-list">
              {places.map((place) => (
                <li key={place.placeId}>
                  <a href={`/place/${place.placeId}`}>{place.name}</a>
                  <span className="visited-meta">
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
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
