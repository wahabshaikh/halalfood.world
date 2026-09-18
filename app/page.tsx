import FoodMap from "./food-map";
import { APPROXIMATE_NOTE, canonical, jsonLdScript, SITE_NAME, SITE_URL } from "../src/lib/seo";

/**
 * The map itself is a client component. The JSON-LD and the `<noscript>`
 * summary below give crawlers and answer engines something concrete without
 * pretending the map is server-rendered; the crawlable inventory lives on
 * `/cities`, `/city/[citySlug]` and `/place/[id]`.
 */
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: SITE_NAME,
              url: SITE_URL,
              description:
                "A world map of halal food, searchable by city or name, with transparent halal evidence.",
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "How accurate are the pins on the Halalfood map?",
                  acceptedAnswer: { "@type": "Answer", text: APPROXIMATE_NOTE },
                },
                {
                  "@type": "Question",
                  name: "Are all the restaurants on Halalfood halal?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "halalfood.world only lists places published as halal by the public directories it collects from. Certification varies by country, so check with the restaurant if that matters to you.",
                  },
                },
              ],
            },
          ]),
        }}
      />
      <FoodMap />
      <noscript>
        <div className="noscript-fallback">
          <h1>halalfood.world — find halal food anywhere in the world</h1>
          <p>
            The interactive map needs JavaScript. The full directory works
            without it:
          </p>
          <ul>
            <li>
              <a href={canonical("/cities")}>Browse halal food by city</a>
            </li>
          </ul>
          <p>{APPROXIMATE_NOTE}</p>
        </div>
      </noscript>
    </>
  );
}
