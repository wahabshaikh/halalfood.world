import { validateGooglePlaceQuery } from "@/lib/core/place-submission";
import { searchPlaces } from "./places";
import {
  getGooglePlacesApiKey,
  searchGooglePlaces,
  type GooglePlaceSearchSuggestion,
  type GoogleSearchArea,
} from "./google-places";
import {
  d1GoogleSearchBudget,
  readGoogleSearchDailyCap,
  type GoogleSearchBudget,
} from "./google-search-budget";
import {
  consumeGooglePlaceSearchLimits,
  retryAfterSeconds,
} from "./otp-rate-limit";

/**
 * Anonymous Places Text Search. 5 calls per 60 seconds, keyed by IP.
 * The binding is per Cloudflare location; the D1 daily cap is the global bill.
 */
export const GOOGLE_SEARCH_ANON_BINDING = "GOOGLE_SEARCH_ANON";
export const GOOGLE_SEARCH_ANON_NAMESPACE = "81001";
export const GOOGLE_SEARCH_ANON_LIMIT = 5;

/**
 * Signed-in Places Text Search. Higher than the anonymous limit, keyed by user id
 * so a shared network does not spend the visitor's budget.
 */
export const GOOGLE_SEARCH_USER_BINDING = "GOOGLE_SEARCH_USER";
export const GOOGLE_SEARCH_USER_NAMESPACE = "81002";
export const GOOGLE_SEARCH_USER_LIMIT = 20;

export const GOOGLE_SEARCH_LIMIT_PERIOD_SECONDS = 60;

/** Preview uploads must not share the production counters. */
export const PREVIEW_GOOGLE_SEARCH_ANON_NAMESPACE = "81101";
export const PREVIEW_GOOGLE_SEARCH_USER_NAMESPACE = "81102";

/** Repeated queries for the same place should not call Google again the same day. */
export const GOOGLE_SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60;

export const GOOGLE_SEARCH_DAILY_CAP_COPY =
  "We’ve paused extra Google lookups for today. Places already listed are below. You can still add a place with a link, and a moderator reviews it before it is listed.";

export const GOOGLE_SEARCH_PROVIDER_COPY =
  "Google search didn’t work. Add the place with a link instead. A moderator reviews it before it is listed.";

export const GOOGLE_SEARCH_UNAVAILABLE_COPY =
  "Google search is temporarily unavailable. Please try again.";

export function googleSearchRateLimitMessage(signedIn: boolean): string {
  return signedIn
    ? "Too many Google searches on this account. Wait a moment, then try again."
    : "Too many Google searches from this network. Wait a moment, then try again.";
}

export type LocalListedPlace = {
  id: string;
  name: string;
  address: string;
};

export type GoogleSearchCache = {
  get(key: string): Promise<GooglePlaceSearchSuggestion[] | null>;
  set(key: string, value: GooglePlaceSearchSuggestion[], ttlSeconds: number): Promise<void>;
};

export type GoogleSearchRateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type GoogleSearchLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type WorkersCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

const CACHE_NAME = "halalfood-google-search";
const CACHE_ORIGIN = "https://google-search.halalfood.internal/";

function collapseQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function roundCoordinate(value: number): string {
  return value.toFixed(1);
}

/**
 * Cache identity for a Google Text Search.
 * The text is lowercased, trimmed, and has its whitespace collapsed.
 * A bbox, when the query has one, is bucketed to 0.1 degrees; otherwise a
 * point bias is bucketed the same way. Queries with neither share one bucket.
 */
export function googleSearchCacheKey(query: string, area: GoogleSearchArea = {}): string {
  const text = collapseQuery(query).toLowerCase();
  const bbox = area.bbox;
  if (
    bbox &&
    [bbox.west, bbox.south, bbox.east, bbox.north].every((value) => Number.isFinite(value))
  ) {
    const bucket = [bbox.west, bbox.south, bbox.east, bbox.north].map(roundCoordinate).join(",");
    return `v1:${text}:bbox:${bucket}`;
  }
  if (area.near && Number.isFinite(area.near.lat) && Number.isFinite(area.near.lng)) {
    return `v1:${text}:loc:${roundCoordinate(area.near.lat)},${roundCoordinate(area.near.lng)}`;
  }
  return `v1:${text}:none`;
}

export function memoryGoogleSearchCache(
  now: () => number = Date.now,
): GoogleSearchCache {
  const store = new Map<string, { expiresAt: number; value: GooglePlaceSearchSuggestion[] }>();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { expiresAt: now() + ttlSeconds * 1000, value });
    },
  };
}

async function openGoogleSearchEdgeCache(): Promise<WorkersCache | null> {
  try {
    const storage = (globalThis as { caches?: { open?: (name: string) => Promise<WorkersCache> } })
      .caches;
    return typeof storage?.open === "function" ? await storage.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

function edgeRequest(key: string): Request {
  return new Request(CACHE_ORIGIN + encodeURIComponent(key));
}

/**
 * Isolate memory plus the Workers Cache API. The named cache is not the
 * zone HTTP cache, so a public URL cannot read these Google payloads.
 */
export function layeredGoogleSearchCache(
  memory: GoogleSearchCache,
  openEdge: () => Promise<WorkersCache | null> = openGoogleSearchEdgeCache,
): GoogleSearchCache {
  return {
    async get(key) {
      const local = await memory.get(key);
      if (local) return local;
      const edge = await openEdge();
      if (!edge) return null;
      try {
        const hit = await edge.match(edgeRequest(key));
        if (!hit) return null;
        const value = (await hit.json()) as GooglePlaceSearchSuggestion[];
        if (!Array.isArray(value)) return null;
        await memory.set(key, value, GOOGLE_SEARCH_CACHE_TTL_SECONDS);
        return value;
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      await memory.set(key, value, ttlSeconds);
      const edge = await openEdge();
      if (!edge) return;
      try {
        await edge.put(
          edgeRequest(key),
          Response.json(value, {
            headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
          }),
        );
      } catch {
        // A cache write must never fail the search.
      }
    },
  };
}

const sharedMemory = memoryGoogleSearchCache();
let productionCache: GoogleSearchCache | null = null;

export function productionGoogleSearchCache(): GoogleSearchCache {
  if (!productionCache) productionCache = layeredGoogleSearchCache(sharedMemory);
  return productionCache;
}

export async function readGoogleSearchRateLimiter(
  signedIn: boolean,
): Promise<GoogleSearchRateLimiter | null> {
  try {
    const workers = await import("cloudflare:workers");
    const name = signedIn ? GOOGLE_SEARCH_USER_BINDING : GOOGLE_SEARCH_ANON_BINDING;
    const candidate = workers.env?.[name];
    if (!candidate || typeof candidate !== "object") return null;
    const limiter = candidate as { limit?: unknown };
    return typeof limiter.limit === "function" ? (candidate as GoogleSearchRateLimiter) : null;
  } catch {
    return null;
  }
}

/**
 * Prefer the Workers Rate Limiting binding. When it is not on the isolate
 * (tests, a misconfigured upload), fall back to the durable D1 counter so
 * the paid call is still bounded.
 */
export async function limitGoogleSearch(
  input: { userId: string | null; ip: string },
  deps: {
    readLimiter?: (signedIn: boolean) => Promise<GoogleSearchRateLimiter | null>;
    consumeFallback?: typeof consumeGooglePlaceSearchLimits;
  } = {},
): Promise<GoogleSearchLimitDecision> {
  const signedIn = Boolean(input.userId);
  const readLimiter = deps.readLimiter ?? readGoogleSearchRateLimiter;
  const binding = await readLimiter(signedIn);
  if (binding) {
    const { success } = await binding.limit({ key: input.userId ?? input.ip });
    return {
      allowed: success,
      retryAfterSeconds: success ? 0 : GOOGLE_SEARCH_LIMIT_PERIOD_SECONDS,
    };
  }
  const consume = deps.consumeFallback ?? consumeGooglePlaceSearchLimits;
  const decision = await consume(input.userId, input.ip);
  return {
    allowed: decision.allowed,
    retryAfterSeconds: decision.allowed ? 0 : retryAfterSeconds(decision.retryAfterMs),
  };
}

async function defaultLocalSearch(query: string): Promise<LocalListedPlace[]> {
  const found = await searchPlaces(query, { limit: 5 });
  return found.map((place) => ({
    id: place.id,
    name: place.name,
    address: place.area,
  }));
}

export type GuardedGoogleSearchInput = {
  query: string;
  userId: string | null;
  ip: string;
} & GoogleSearchArea;

export type GuardedGoogleSearch =
  | { outcome: "invalid"; status: 400; message: string }
  | { outcome: "unavailable"; status: 503; message: string }
  | {
      outcome: "rate_limited";
      status: 429;
      message: string;
      retryAfterSeconds: number;
    }
  | {
      outcome: "capped";
      status: 200;
      message: string;
      local: LocalListedPlace[];
      fallback: "link";
    }
  | { outcome: "results"; status: 200; places: GooglePlaceSearchSuggestion[]; cached: boolean }
  | { outcome: "provider_error"; status: 502; message: string; fallback: "link" };

export type GuardedGoogleSearchDeps = {
  now?: Date;
  cap?: number;
  apiKey?: string | null;
  limit?: (input: { userId: string | null; ip: string }) => Promise<GoogleSearchLimitDecision>;
  cache?: GoogleSearchCache;
  budget?: GoogleSearchBudget;
  search?: typeof searchGooglePlaces;
  localSearch?: (query: string) => Promise<LocalListedPlace[]>;
};

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

/** A Google result we already have: a listed place to open, or one under review. */
export type GoogleResultExisting =
  | { status: "listed"; placeId: string; name: string; url: string }
  | { status: "pending" | "known"; name: string };

export function googleSearchResponse(
  result: GuardedGoogleSearch,
  existing: Array<GoogleResultExisting | null> = [],
): Response {
  const headers = noStoreHeaders();
  switch (result.outcome) {
    case "invalid":
      return Response.json({ error: result.message }, { status: 400, headers });
    case "unavailable":
      return Response.json({ error: result.message }, { status: 503, headers });
    case "rate_limited":
      return Response.json(
        { error: result.message },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": String(result.retryAfterSeconds),
            "X-Retry-After": String(result.retryAfterSeconds),
          },
        },
      );
    case "capped":
      return Response.json(
        {
          places: [],
          local: result.local,
          fallback: result.fallback,
          limited: "daily",
          error: result.message,
        },
        { status: 200, headers },
      );
    case "results":
      return Response.json(
        {
          places: result.places.map((place, index) => ({
            id: place.id,
            name: place.displayName,
            address: place.formattedAddress,
            existing: existing[index] ?? null,
          })),
        },
        { headers },
      );
    case "provider_error":
      return Response.json(
        { error: result.message, fallback: result.fallback },
        { status: 502, headers },
      );
  }
}

async function listedOrEmpty(
  query: string,
  localSearch: (query: string) => Promise<LocalListedPlace[]>,
): Promise<LocalListedPlace[]> {
  try {
    return await localSearch(query);
  } catch {
    return [];
  }
}

/**
 * Decide whether a Places Text Search may call Google.
 * Short queries, cache hits, rate limits, and the daily cap all return
 * before `search` runs.
 */
export async function guardedGoogleTextSearch(
  input: GuardedGoogleSearchInput,
  deps: GuardedGoogleSearchDeps = {},
): Promise<GuardedGoogleSearch> {
  const parsed = validateGooglePlaceQuery(input.query);
  if (!parsed.ok) return { outcome: "invalid", status: 400, message: parsed.error };

  const text = parsed.query;
  const area: GoogleSearchArea = { near: input.near ?? null, bbox: input.bbox ?? null };
  const cache = deps.cache ?? productionGoogleSearchCache();
  const key = googleSearchCacheKey(text, area);
  try {
    const hit = await cache.get(key);
    if (hit) return { outcome: "results", status: 200, places: hit, cached: true };
  } catch {
    // A broken cache falls through to a live lookup, which is still capped.
  }

  const apiKey = deps.apiKey !== undefined ? deps.apiKey : getGooglePlacesApiKey();
  if (!apiKey) {
    return {
      outcome: "unavailable",
      status: 503,
      message: "Search is paused right now. Please try again later.",
    };
  }

  const limit = deps.limit ?? limitGoogleSearch;
  let decision: GoogleSearchLimitDecision;
  try {
    decision = await limit({ userId: input.userId, ip: input.ip });
  } catch {
    return { outcome: "unavailable", status: 503, message: GOOGLE_SEARCH_UNAVAILABLE_COPY };
  }
  if (!decision.allowed) {
    return {
      outcome: "rate_limited",
      status: 429,
      message: googleSearchRateLimitMessage(Boolean(input.userId)),
      retryAfterSeconds: Math.max(1, decision.retryAfterSeconds),
    };
  }

  const localSearch = deps.localSearch ?? defaultLocalSearch;
  const budget = deps.budget ?? d1GoogleSearchBudget();
  const cap = deps.cap ?? (await readGoogleSearchDailyCap());
  const now = deps.now ?? new Date();
  let reserved = false;
  try {
    reserved = await budget.tryConsume(cap, now);
  } catch {
    reserved = false;
  }
  if (!reserved) {
    return {
      outcome: "capped",
      status: 200,
      message: GOOGLE_SEARCH_DAILY_CAP_COPY,
      local: await listedOrEmpty(text, localSearch),
      fallback: "link",
    };
  }

  const search = deps.search ?? searchGooglePlaces;
  let result;
  try {
    result = await search(text, area);
  } catch {
    return { outcome: "provider_error", status: 502, message: GOOGLE_SEARCH_PROVIDER_COPY, fallback: "link" };
  }
  if (!result.ok) {
    if (result.code === "NOT_CONFIGURED") {
      return {
        outcome: "unavailable",
        status: 503,
        message: "Search is paused right now. Please try again later.",
      };
    }
    if (result.code === "INVALID_QUERY") {
      return { outcome: "invalid", status: 400, message: result.message };
    }
    return { outcome: "provider_error", status: 502, message: GOOGLE_SEARCH_PROVIDER_COPY, fallback: "link" };
  }

  try {
    await cache.set(key, result.places, GOOGLE_SEARCH_CACHE_TTL_SECONDS);
  } catch {
    // The caller still gets the places Google already returned.
  }
  return { outcome: "results", status: 200, places: result.places, cached: false };
}
