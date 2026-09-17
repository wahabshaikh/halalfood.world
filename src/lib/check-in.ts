/**
 * The ten-second check-in: the product's primary quality signal, replacing
 * star ratings entirely.
 *
 * Two safeguards are enforced here rather than in the UI:
 *
 * - Verified and unverified experience are aggregated separately and never
 *   merged into one number.
 * - A percentage is not published from a sample too small to interpret. Below
 *   `MIN_PUBLISHABLE_SAMPLE` the summary returns counts and an
 *   `insufficient-data` state instead.
 */

import {
  isRelationship,
  type Relationship,
} from "./halal-taxonomy";

export const WOULD_RETURN = ["definitely", "maybe", "no"] as const;
export type WouldReturn = (typeof WOULD_RETURN)[number];

export const WOULD_BRING_FRIEND = ["yes", "maybe", "no"] as const;
export type WouldBringFriend = (typeof WOULD_BRING_FRIEND)[number];

export const VALUE_VERDICTS = ["great", "fair", "overpriced"] as const;
export type ValueVerdict = (typeof VALUE_VERDICTS)[number];

export const DISH_VERDICTS = ["order-again", "fine", "avoid"] as const;
export type DishVerdict = (typeof DISH_VERDICTS)[number];

export const VISIT_CONTEXT_KEYS = [
  "service",
  "meal",
  "group",
  "occasion",
  "queue",
] as const;

export const VISIT_CONTEXT_VALUES: Record<
  (typeof VISIT_CONTEXT_KEYS)[number],
  readonly string[]
> = {
  service: ["dine-in", "takeaway", "delivery"],
  meal: ["breakfast", "lunch", "dinner", "late-night", "snack"],
  group: ["solo", "couple", "friends", "family", "work"],
  occasion: ["everyday", "celebration", "travel", "iftar", "suhoor"],
  queue: ["none", "short", "long"],
};

/** Below this many check-ins the product shows counts, not a percentage. */
export const MIN_PUBLISHABLE_SAMPLE = 5;

export const WOULD_RETURN_COPY: Record<WouldReturn, string> = {
  definitely: "Definitely",
  maybe: "Maybe",
  no: "No",
};

export const VALUE_COPY: Record<ValueVerdict, string> = {
  great: "Great value",
  fair: "Fair",
  overpriced: "Overpriced",
};

export const DISH_VERDICT_COPY: Record<DishVerdict, string> = {
  "order-again": "Order again",
  fine: "Fine",
  avoid: "Avoid",
};

export type CheckInDishInput = {
  name: string;
  verdict: DishVerdict;
  dishId?: string | null;
};

export type ValidatedCheckIn = {
  wouldReturn: WouldReturn;
  wouldBringFriend: WouldBringFriend | null;
  valueVerdict: ValueVerdict;
  spendMinor: number | null;
  currency: string | null;
  note: string | null;
  incentivized: boolean;
  relationship: Relationship;
  dishes: CheckInDishInput[];
  context: Record<string, string>;
  visibility: "public" | "private";
};

export type CheckInValidation =
  | { ok: true; data: ValidatedCheckIn }
  | { ok: false; error: string };

/**
 * Dish names are matched across contributors, so they are folded to a stable
 * key: lowercased, accent-stripped, punctuation removed, spaces collapsed.
 */
export function normalizeDishName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

export function validateCheckIn(input: unknown): CheckInValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  if (!(WOULD_RETURN as readonly unknown[]).includes(body.wouldReturn))
    return { ok: false, error: "Choose whether you would return: definitely, maybe or no." };
  if (!(VALUE_VERDICTS as readonly unknown[]).includes(body.valueVerdict))
    return { ok: false, error: "Choose a value verdict: great, fair or overpriced." };

  let wouldBringFriend: WouldBringFriend | null = null;
  if (body.wouldBringFriend !== undefined && body.wouldBringFriend !== null) {
    if (!(WOULD_BRING_FRIEND as readonly unknown[]).includes(body.wouldBringFriend))
      return { ok: false, error: "Would bring a friend must be yes, maybe or no." };
    wouldBringFriend = body.wouldBringFriend as WouldBringFriend;
  }

  let spendMinor: number | null = null;
  if (body.spendMinor !== undefined && body.spendMinor !== null) {
    if (
      typeof body.spendMinor !== "number" ||
      !Number.isSafeInteger(body.spendMinor) ||
      body.spendMinor < 0 ||
      body.spendMinor > 100_000_000
    )
      return { ok: false, error: "Spend per person must be a whole amount in minor units." };
    spendMinor = body.spendMinor;
  }

  let currency: string | null = null;
  if (body.currency !== undefined && body.currency !== null) {
    if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency))
      return { ok: false, error: "Currency must be a three-letter code." };
    currency = body.currency;
  }
  if (spendMinor !== null && !currency)
    return { ok: false, error: "Send a currency alongside the spend amount." };

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    note = trimmedString(body.note, 2000);
    if (!note) return { ok: false, error: "The note must be 2000 characters or fewer." };
  }

  const relationship = body.relationship ?? "none";
  if (!isRelationship(relationship))
    return { ok: false, error: "Declare your relationship with the restaurant." };

  const incentivized = body.incentivized === true;

  const visibility = body.visibility ?? "public";
  if (visibility !== "public" && visibility !== "private")
    return { ok: false, error: "Visibility must be public or private." };

  const dishes: CheckInDishInput[] = [];
  if (body.dishes !== undefined && body.dishes !== null) {
    if (!Array.isArray(body.dishes))
      return { ok: false, error: "Dishes must be an array." };
    if (body.dishes.length > 20)
      return { ok: false, error: "Record at most 20 dishes per visit." };
    const seen = new Set<string>();
    for (const raw of body.dishes) {
      if (!raw || typeof raw !== "object")
        return { ok: false, error: "Each dish needs a name and a verdict." };
      const dish = raw as Record<string, unknown>;
      const name = trimmedString(dish.name, 120);
      if (!name) return { ok: false, error: "Each dish needs a name of 120 characters or fewer." };
      const normalized = normalizeDishName(name);
      if (!normalized) return { ok: false, error: `"${name}" is not a usable dish name.` };
      if (seen.has(normalized))
        return { ok: false, error: `"${name}" is listed twice.` };
      seen.add(normalized);
      if (!(DISH_VERDICTS as readonly unknown[]).includes(dish.verdict))
        return {
          ok: false,
          error: "Each dish verdict must be order-again, fine or avoid.",
        };
      const dishId =
        typeof dish.dishId === "string" && dish.dishId ? dish.dishId : null;
      dishes.push({ name, verdict: dish.verdict as DishVerdict, dishId });
    }
  }

  const context: Record<string, string> = {};
  if (body.context !== undefined && body.context !== null) {
    if (typeof body.context !== "object" || Array.isArray(body.context))
      return { ok: false, error: "Context must be an object." };
    for (const [key, value] of Object.entries(body.context as Record<string, unknown>)) {
      if (!(VISIT_CONTEXT_KEYS as readonly string[]).includes(key))
        return { ok: false, error: `Unknown visit context "${key}".` };
      const allowed = VISIT_CONTEXT_VALUES[key as (typeof VISIT_CONTEXT_KEYS)[number]];
      if (typeof value !== "string" || !allowed.includes(value))
        return { ok: false, error: `Unknown value for visit context "${key}".` };
      context[key] = value;
    }
  }

  return {
    ok: true,
    data: {
      wouldReturn: body.wouldReturn as WouldReturn,
      wouldBringFriend,
      valueVerdict: body.valueVerdict as ValueVerdict,
      spendMinor,
      currency,
      note,
      incentivized,
      relationship,
      dishes,
      context,
      visibility,
    },
  };
}

/* ------------------------------------------------------------ aggregation -- */

export type CheckInRecord = {
  wouldReturn: WouldReturn;
  valueVerdict: ValueVerdict;
  spendMinor?: number | null;
  currency?: string | null;
  /** Derived from the visit's verification, not self-asserted. */
  verified: boolean;
  /** Incentivized or undisclosed-conflict feedback is excluded from ranking. */
  incentivized?: boolean;
  relationship?: Relationship;
};

export type ReturnIntentBucket = {
  count: number;
  /** null whenever the sample is too small to publish a percentage. */
  wouldReturnPercent: number | null;
  definitely: number;
  maybe: number;
  no: number;
  insufficientData: boolean;
};

export type CheckInSummary = {
  verified: ReturnIntentBucket;
  unverified: ReturnIntentBucket;
  excludedCount: number;
  value: { great: number; fair: number; overpriced: number };
  medianSpendMinor: number | null;
  currency: string | null;
};

function emptyBucket(): ReturnIntentBucket {
  return {
    count: 0,
    wouldReturnPercent: null,
    definitely: 0,
    maybe: 0,
    no: 0,
    insufficientData: true,
  };
}

function finishBucket(bucket: ReturnIntentBucket): ReturnIntentBucket {
  const insufficientData = bucket.count < MIN_PUBLISHABLE_SAMPLE;
  return {
    ...bucket,
    insufficientData,
    wouldReturnPercent: insufficientData
      ? null
      : Math.round((bucket.definitely / bucket.count) * 100),
  };
}

/** Feedback that is rewarded or comes from an interested party never ranks. */
export function countsTowardsRanking(record: CheckInRecord): boolean {
  if (record.incentivized) return false;
  return (record.relationship ?? "none") === "none";
}

export function summarizeCheckIns(
  records: readonly CheckInRecord[],
): CheckInSummary {
  const verified = emptyBucket();
  const unverified = emptyBucket();
  const value = { great: 0, fair: 0, overpriced: 0 };
  const spends: number[] = [];
  const currencies = new Set<string>();
  let excludedCount = 0;

  for (const record of records) {
    if (!countsTowardsRanking(record)) {
      excludedCount += 1;
      continue;
    }
    const bucket = record.verified ? verified : unverified;
    bucket.count += 1;
    bucket[record.wouldReturn] += 1;
    value[record.valueVerdict] += 1;
    if (typeof record.spendMinor === "number" && record.spendMinor >= 0) {
      spends.push(record.spendMinor);
      if (record.currency) currencies.add(record.currency);
    }
  }

  spends.sort((a, b) => a - b);
  const medianSpendMinor = spends.length
    ? spends.length % 2
      ? spends[(spends.length - 1) / 2]
      : Math.round((spends[spends.length / 2 - 1] + spends[spends.length / 2]) / 2)
    : null;

  return {
    verified: finishBucket(verified),
    unverified: finishBucket(unverified),
    excludedCount,
    value,
    medianSpendMinor,
    currency: currencies.size === 1 ? [...currencies][0] : null,
  };
}

/* --------------------------------------------------------- dish highlights -- */

export type DishVerdictRecord = {
  name: string;
  normalizedName: string;
  verdict: DishVerdict;
  spendMinor?: number | null;
};

export type DishStat = {
  name: string;
  normalizedName: string;
  orders: number;
  orderAgain: number;
  fine: number;
  avoid: number;
  /** null while the dish has fewer than `MIN_DISH_SAMPLE` verdicts. */
  orderAgainPercent: number | null;
};

export const MIN_DISH_SAMPLE = 3;

export type DishHighlights = {
  mostOrdered: DishStat[];
  mostRecommended: DishStat[];
  commonlyAvoided: DishStat[];
  insufficientData: boolean;
};

export function summarizeDishes(
  records: readonly DishVerdictRecord[],
  limit = 5,
): DishHighlights {
  const byDish = new Map<string, DishStat>();
  for (const record of records) {
    const key = record.normalizedName;
    if (!key) continue;
    const stat =
      byDish.get(key) ??
      ({
        name: record.name,
        normalizedName: key,
        orders: 0,
        orderAgain: 0,
        fine: 0,
        avoid: 0,
        orderAgainPercent: null,
      } satisfies DishStat);
    stat.orders += 1;
    if (record.verdict === "order-again") stat.orderAgain += 1;
    else if (record.verdict === "fine") stat.fine += 1;
    else stat.avoid += 1;
    byDish.set(key, stat);
  }

  const stats = [...byDish.values()].map((stat) => ({
    ...stat,
    orderAgainPercent:
      stat.orders >= MIN_DISH_SAMPLE
        ? Math.round((stat.orderAgain / stat.orders) * 100)
        : null,
  }));

  const byOrders = [...stats].sort(
    (a, b) => b.orders - a.orders || a.name.localeCompare(b.name),
  );
  const recommended = stats
    .filter((stat) => stat.orderAgainPercent !== null && stat.orderAgainPercent >= 60)
    .sort(
      (a, b) =>
        (b.orderAgainPercent ?? 0) - (a.orderAgainPercent ?? 0) ||
        b.orders - a.orders ||
        a.name.localeCompare(b.name),
    );
  const avoided = stats
    .filter((stat) => stat.orders >= MIN_DISH_SAMPLE && stat.avoid > stat.orderAgain)
    .sort((a, b) => b.avoid - a.avoid || a.name.localeCompare(b.name));

  return {
    mostOrdered: byOrders.slice(0, limit),
    mostRecommended: recommended.slice(0, limit),
    commonlyAvoided: avoided.slice(0, limit),
    insufficientData: stats.every((stat) => stat.orders < MIN_DISH_SAMPLE),
  };
}
