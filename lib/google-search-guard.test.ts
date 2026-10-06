import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { presentHttpFailure } from "./failure-copy";
import { d1GoogleSearchBudget, parseGoogleSearchDailyCap } from "./google-search-budget";
import {
  GOOGLE_SEARCH_ANON_LIMIT,
  GOOGLE_SEARCH_ANON_NAMESPACE,
  GOOGLE_SEARCH_CACHE_TTL_SECONDS,
  GOOGLE_SEARCH_DAILY_CAP_COPY,
  GOOGLE_SEARCH_USER_LIMIT,
  GOOGLE_SEARCH_USER_NAMESPACE,
  googleSearchCacheKey,
  googleSearchRateLimitMessage,
  googleSearchResponse,
  guardedGoogleTextSearch,
  layeredGoogleSearchCache,
  limitGoogleSearch,
  memoryGoogleSearchCache,
  type GoogleSearchCache,
  type GoogleSearchRateLimiter,
} from "./google-search-guard";
import { searchGooglePlaces } from "./google-places";
import { parseWranglerJsonc } from "./preview-bindings";
import { GET as googleSearchGet } from "@/app/api/places/google-search/route";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";

const KEY = "GOOGLE_PLACES_API_KEY";

function withApiKey() {
  const previous = process.env[KEY];
  process.env[KEY] = "places-test-key";
  return () => {
    if (previous === undefined) delete process.env[KEY];
    else process.env[KEY] = previous;
  };
}

function trackGoogle() {
  const calls: string[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("places.googleapis.com")) {
      return previous(input, init);
    }
    calls.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({
        places: [
          {
            id: "ChIJexample",
            displayName: { text: "Example Kitchen" },
            formattedAddress: "1 Example Street",
          },
        ],
      }),
    );
  };
  return {
    calls,
    restore() {
      globalThis.fetch = previous;
    },
  };
}

function allowingLimit(): {
  limit: (input: { userId: string | null; ip: string }) => Promise<{
    allowed: boolean;
    retryAfterSeconds: number;
  }>;
  seen: { userId: string | null; ip: string }[];
} {
  const seen: { userId: string | null; ip: string }[] = [];
  return {
    seen,
    async limit(input) {
      seen.push(input);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function openBudget(allow = true) {
  const consumes: number[] = [];
  return {
    consumes,
    budget: {
      async tryConsume(cap: number) {
        consumes.push(cap);
        return allow;
      },
    },
  };
}

const localPlace = { id: "listed-1", name: "Listed Kitchen", address: "9 Market" };

async function searchWith(
  query: string,
  extra: Parameters<typeof guardedGoogleTextSearch>[1] & {
    userId?: string | null;
    near?: { lat: number; lng: number } | null;
    bbox?: { west: number; south: number; east: number; north: number } | null;
  } = {},
) {
  const { userId = null, near = null, bbox = null, ...deps } = extra;
  return guardedGoogleTextSearch(
    { query, userId, ip: "203.0.113.8", near, bbox },
    {
      apiKey: "places-test-key",
      cap: 1000,
      now: new Date("2026-10-04T12:00:00Z"),
      localSearch: async () => [localPlace],
      ...deps,
    },
  );
}

test("cache keys collapse case and whitespace and bucket location", () => {
  assert.equal(googleSearchCacheKey("  Foo   BAR "), googleSearchCacheKey("foo bar"));
  assert.equal(
    googleSearchCacheKey("Foo Bar", { near: { lat: 51.51, lng: -0.14 } }),
    googleSearchCacheKey("foo   bar", { near: { lat: 51.54, lng: -0.11 } }),
  );
  assert.notEqual(
    googleSearchCacheKey("foo bar", { near: { lat: 51.5, lng: -0.1 } }),
    googleSearchCacheKey("foo bar", { near: { lat: 25.2, lng: 55.3 } }),
  );
  const bbox = { west: -0.2, south: 51.4, east: 0.1, north: 51.6 };
  assert.notEqual(
    googleSearchCacheKey("foo bar", { bbox }),
    googleSearchCacheKey("foo bar", { near: { lat: 51.5, lng: -0.1 } }),
  );
  assert.equal(googleSearchCacheKey("foo bar", { bbox }), googleSearchCacheKey("FOO   bar", { bbox }));
});

test("short queries never call Google", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  const limit = allowingLimit();
  const budget = openBudget();
  let searches = 0;
  try {
    const result = await searchWith("  ab  ", {
      limit: limit.limit,
      budget: budget.budget,
      cache: memoryGoogleSearchCache(),
      search: async (query, options) => {
        searches += 1;
        return searchGooglePlaces(query, options);
      },
    });
    assert.equal(result.outcome, "invalid");
    assert.equal(searches, 0);
    assert.equal(google.calls.length, 0);
    assert.equal(limit.seen.length, 0);
    assert.equal(budget.consumes.length, 0);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("a cached query does not call Google again", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  const cache = memoryGoogleSearchCache();
  const limit = allowingLimit();
  const budget = openBudget();
  try {
    const first = await searchWith("  Example   Kitchen ", {
      limit: limit.limit,
      budget: budget.budget,
      cache,
    });
    const second = await searchWith("example kitchen", {
      limit: limit.limit,
      budget: budget.budget,
      cache,
    });
    assert.equal(first.outcome, "results");
    assert.equal(first.outcome === "results" && first.cached, false);
    assert.equal(second.outcome, "results");
    assert.equal(second.outcome === "results" && second.cached, true);
    if (second.outcome === "results") {
      assert.equal(second.places[0]?.displayName, "Example Kitchen");
    }
    assert.equal(google.calls.length, 1);
    assert.equal(JSON.parse(google.calls[0] ?? "{}").textQuery, "Example Kitchen");
    assert.equal(limit.seen.length, 1);
    assert.equal(budget.consumes.length, 1);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("a different location bucket is a cache miss and the same bucket is not", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  const cache = memoryGoogleSearchCache();
  const limit = allowingLimit();
  const budget = openBudget();
  const deps = { limit: limit.limit, budget: budget.budget, cache };
  try {
    await searchWith("Karachi grill", { ...deps, near: { lat: 51.5, lng: -0.1 } });
    await searchWith("Karachi grill", { ...deps, near: { lat: 25.2, lng: 55.3 } });
    await searchWith("Karachi grill", { ...deps, near: { lat: 51.54, lng: -0.14 } });
    assert.equal(google.calls.length, 2);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("a rate-limited caller does not call Google", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  const budget = openBudget();
  try {
    const result = await searchWith("Karachi grill", {
      cache: memoryGoogleSearchCache(),
      budget: budget.budget,
      userId: null,
      limit: async () => ({ allowed: false, retryAfterSeconds: 60 }),
    });
    assert.equal(result.outcome, "rate_limited");
    if (result.outcome === "rate_limited") {
      assert.equal(result.status, 429);
      assert.match(result.message, /this network/);
      const response = googleSearchResponse(result);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "60");
    }
    assert.equal(google.calls.length, 0);
    assert.equal(budget.consumes.length, 0);

    const signedIn = await searchWith("Karachi grill", {
      cache: memoryGoogleSearchCache(),
      budget: budget.budget,
      userId: "user-1",
      limit: async () => ({ allowed: false, retryAfterSeconds: 60 }),
    });
    assert.equal(signedIn.outcome, "rate_limited");
    if (signedIn.outcome === "rate_limited") assert.match(signedIn.message, /this account/);
    assert.equal(google.calls.length, 0);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("a full daily cap returns listed places and does not call Google", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  const limit = allowingLimit();
  try {
    const result = await searchWith("Karachi grill", {
      cache: memoryGoogleSearchCache(),
      limit: limit.limit,
      budget: openBudget(false).budget,
    });
    assert.equal(result.outcome, "capped");
    if (result.outcome === "capped") {
      assert.equal(result.status, 200);
      assert.equal(result.fallback, "link");
      assert.equal(result.message, GOOGLE_SEARCH_DAILY_CAP_COPY);
      assert.deepEqual(result.local, [localPlace]);
      const response = googleSearchResponse(result);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        places: unknown[];
        local: { id: string }[];
        fallback: string;
        limited: string;
        error: string;
      };
      assert.deepEqual(body.places, []);
      assert.equal(body.local[0]?.id, "listed-1");
      assert.equal(body.fallback, "link");
      assert.equal(body.limited, "daily");
      assert.match(body.error, /add a place with a link/i);
    }
    assert.equal(google.calls.length, 0);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("a budget store that throws skips Google and still returns the link fallback", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  try {
    const result = await searchWith("Karachi grill", {
      cache: memoryGoogleSearchCache(),
      limit: allowingLimit().limit,
      budget: {
        async tryConsume() {
          throw new Error("google_search_daily is missing");
        },
      },
    });
    assert.equal(result.outcome, "capped");
    assert.equal(google.calls.length, 0);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("the Workers rate limiter is preferred and signed-in callers get the higher bucket", async () => {
  const keys: { signedIn: boolean; key: string }[] = [];
  const limiter = (signedIn: boolean): GoogleSearchRateLimiter => ({
    async limit({ key }) {
      keys.push({ signedIn, key });
      return { success: key !== "203.0.113.9" };
    },
  });
  const anon = await limitGoogleSearch(
    { userId: null, ip: "203.0.113.8" },
    { readLimiter: async (signedIn) => limiter(signedIn) },
  );
  const user = await limitGoogleSearch(
    { userId: "user-7", ip: "203.0.113.8" },
    { readLimiter: async (signedIn) => limiter(signedIn) },
  );
  const blocked = await limitGoogleSearch(
    { userId: null, ip: "203.0.113.9" },
    { readLimiter: async (signedIn) => limiter(signedIn) },
  );
  assert.equal(anon.allowed, true);
  assert.equal(user.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.deepEqual(keys, [
    { signedIn: false, key: "203.0.113.8" },
    { signedIn: true, key: "user-7" },
    { signedIn: false, key: "203.0.113.9" },
  ]);

  let fallbackCalls = 0;
  await limitGoogleSearch(
    { userId: "user-7", ip: "203.0.113.8" },
    {
      readLimiter: async () => null,
      consumeFallback: async () => {
        fallbackCalls += 1;
        return { allowed: true, retryAfterMs: 0 };
      },
    },
  );
  assert.equal(fallbackCalls, 1);
});

test("the edge cache answers a repeat query without calling Google", async () => {
  const stored = new Map<string, string>();
  const edge = {
    async match(request: Request) {
      const body = stored.get(request.url);
      return body ? new Response(body) : undefined;
    },
    async put(request: Request, response: Response) {
      stored.set(request.url, await response.text());
    },
  };
  const cache: GoogleSearchCache = layeredGoogleSearchCache(memoryGoogleSearchCache(), async () => edge);
  const google = trackGoogle();
  const restoreKey = withApiKey();
  try {
    await searchWith("Example Kitchen", {
      cache,
      limit: allowingLimit().limit,
      budget: openBudget().budget,
    });
    const coldMemory = layeredGoogleSearchCache(memoryGoogleSearchCache(), async () => edge);
    const second = await searchWith("example kitchen", {
      cache: coldMemory,
      limit: allowingLimit().limit,
      budget: openBudget().budget,
    });
    assert.equal(second.outcome, "results");
    assert.equal(second.outcome === "results" && second.cached, true);
    assert.equal(google.calls.length, 1);
    assert.ok(GOOGLE_SEARCH_CACHE_TTL_SECONDS >= 60 * 60);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("the D1 daily counter stops at the cap and resets the next UTC day", async () => {
  const { db } = createTestDatabase();
  const budget = d1GoogleSearchBudget(db);
  const day = new Date("2026-10-04T23:00:00Z");
  assert.equal(await budget.tryConsume(2, day), true);
  assert.equal(await budget.tryConsume(2, day), true);
  assert.equal(await budget.tryConsume(2, day), false);
  assert.equal(await budget.tryConsume(2, new Date("2026-10-05T00:00:00Z")), true);
  assert.equal(await budget.tryConsume(0, day), false);
  assert.equal(await budget.tryConsume(1, day, "details"), true);
  assert.equal(await budget.tryConsume(1, day, "details"), false);
  assert.equal(await budget.tryConsume(1, new Date("2026-10-05T00:00:00Z"), "details"), true);
  assert.equal(parseGoogleSearchDailyCap(""), 1000);
  assert.equal(parseGoogleSearchDailyCap("250"), 250);
  assert.equal(parseGoogleSearchDailyCap("nope"), 1000);
});

test("wrangler declares a lower anonymous rate limit and the daily cap var", () => {
  const config = parseWranglerJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const anon = config.ratelimits?.find((entry) => entry.name === "GOOGLE_SEARCH_ANON");
  const user = config.ratelimits?.find((entry) => entry.name === "GOOGLE_SEARCH_USER");
  assert.equal(anon?.namespace_id, GOOGLE_SEARCH_ANON_NAMESPACE);
  assert.equal(user?.namespace_id, GOOGLE_SEARCH_USER_NAMESPACE);
  assert.equal(anon?.simple?.limit, GOOGLE_SEARCH_ANON_LIMIT);
  assert.equal(user?.simple?.limit, GOOGLE_SEARCH_USER_LIMIT);
  assert.equal(anon?.simple?.period, 60);
  assert.equal(user?.simple?.period, 60);
  assert.ok((user?.simple?.limit ?? 0) > (anon?.simple?.limit ?? 0));
  assert.equal(config.vars?.GOOGLE_SEARCH_DAILY_CAP, "1000");
  assert.equal(config.vars?.GOOGLE_DETAILS_DAILY_CAP, "1000");
});

test("429 Google search copy comes from presentHttpFailure", () => {
  const presented = presentHttpFailure("Google search", 429, googleSearchRateLimitMessage(false));
  assert.match(presented.message, /Too many Google searches from this network/);
  assert.match(presented.message, /Reference [a-z0-9-]{4,16}\./i);
  assert.equal(presented.retry, true);
  assert.equal(presented.message.includes("Failed to fetch"), false);
  const form = readFileSync(new URL("../app/add/add-flow.tsx", import.meta.url), "utf8");
  assert.match(form, /presentHttpFailure\("Google search", failure\.status/);
});

test("the search route skips Google for a short query", async () => {
  const google = trackGoogle();
  const restoreKey = withApiKey();
  try {
    const short = await googleSearchGet(
      new Request("https://halalfood.world/api/places/google-search?q=ab"),
    );
    assert.equal(short.status, 400);
    const body = (await short.json()) as { error: string };
    assert.match(body.error, /3–120/);
    assert.equal(google.calls.length, 0);
  } finally {
    google.restore();
    restoreKey();
  }
});

test("a Google rejection on the guarded path logs the reason without the key and returns the link fallback", async () => {
  const previousKey = process.env[KEY];
  process.env[KEY] = "AIzaSyTESTKEY000000000000000000000000000";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          code: 403,
          message: "Places API (New) has not been used. key=AIzaSyTESTKEY000000000000000000000000000",
          status: "PERMISSION_DENIED",
          details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }],
        },
      },
      { status: 403 },
    );
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  let result;
  try {
    result = await searchWith("Dishoom London", {
      apiKey: undefined,
      limit: allowingLimit().limit,
      budget: openBudget().budget,
      cache: memoryGoogleSearchCache(),
    });
  } finally {
    console.error = originalError;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env[KEY];
    else process.env[KEY] = previousKey;
  }
  assert.equal(result.outcome, "provider_error");
  const response = googleSearchResponse(result);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).fallback, "link");
  const entry = logged.find((args) => args[0] === "google_places_error")?.[1] as
    | Record<string, unknown>
    | undefined;
  assert.ok(entry, "google_places_error was logged");
  assert.equal(entry.operation, "searchText");
  assert.equal(entry.httpStatus, 403);
  assert.equal(entry.googleStatus, "PERMISSION_DENIED");
  assert.equal(entry.reason, "SERVICE_DISABLED");
  assert.match(String(entry.message), /has not been used/);
  assert.doesNotMatch(JSON.stringify(logged), /AIzaSyTESTKEY/);
});
