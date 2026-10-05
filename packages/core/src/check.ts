import { ANSWERS, FACTS, type Answer, type Fact } from "./halal";

/** "How was it?" — taste only. It never affects halal status. */
export const VERDICTS = ["no", "okay", "liked", "loved"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABEL: Record<Verdict, string> = {
  no: "Not for me",
  okay: "Okay",
  liked: "Liked",
  loved: "Loved",
};

/** The verb a friend's feed card uses. */
export function verdictVerb(verdict: Verdict | null): string {
  if (verdict === "loved") return "loved";
  if (verdict === "liked") return "liked";
  return "checked";
}

export const MAX_DISHES = 5;
export const MAX_DISH_LENGTH = 60;
export const MAX_NOTE_LENGTH = 500;
export const MAX_PHOTOS_PER_CHECK = 4;

export type CheckInput = Record<Fact, Answer> & {
  verdict: Verdict | null;
  dishes: string[];
  note: string | null;
  shared: boolean;
  photoIds: string[];
  idempotencyKey: string;
};

export type CheckValidation = { ok: true; value: CheckInput } | { ok: false; error: string };

function answer(value: unknown): Answer | undefined {
  if (value === null || value === undefined || value === "") return null;
  return (ANSWERS as readonly unknown[]).includes(value) ? (value as Answer) : undefined;
}

const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCheck(body: unknown): CheckValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a check." };
  const input = body as Record<string, unknown>;

  const answers = {} as Record<Fact, Answer>;
  for (const fact of FACTS) {
    const parsed = answer(input[fact]);
    if (parsed === undefined) return { ok: false, error: `Unknown answer for ${fact}.` };
    answers[fact] = parsed;
  }
  if (!FACTS.some((fact) => answers[fact] === "yes" || answers[fact] === "no"))
    return { ok: false, error: "Answer at least one question with Yes or No." };

  let verdict: Verdict | null = null;
  if (input.verdict !== undefined && input.verdict !== null && input.verdict !== "") {
    if (!(VERDICTS as readonly unknown[]).includes(input.verdict))
      return { ok: false, error: "Unknown verdict." };
    verdict = input.verdict as Verdict;
  }

  const rawDishes = input.dishes ?? [];
  if (!Array.isArray(rawDishes)) return { ok: false, error: "Dishes must be a list." };
  const dishes: string[] = [];
  const seen = new Set<string>();
  for (const dish of rawDishes) {
    if (typeof dish !== "string") return { ok: false, error: "Dishes must be text." };
    const name = dish.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (name.length > MAX_DISH_LENGTH) return { ok: false, error: "Dish names are 60 characters at most." };
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dishes.push(name);
  }
  if (dishes.length > MAX_DISHES) return { ok: false, error: "Add up to 5 dishes." };

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string") return { ok: false, error: "The note must be text." };
    const trimmed = input.note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) return { ok: false, error: "Notes are 500 characters at most." };
    note = trimmed || null;
  }

  const rawPhotos = input.photoIds ?? [];
  if (!Array.isArray(rawPhotos) || rawPhotos.length > MAX_PHOTOS_PER_CHECK)
    return { ok: false, error: "Add up to 4 photos." };
  for (const id of rawPhotos)
    if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "Invalid photo." };

  if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY.test(input.idempotencyKey))
    return { ok: false, error: "Missing request key." };

  return {
    ok: true,
    value: {
      ...answers,
      verdict,
      dishes,
      note,
      shared: input.shared !== false,
      photoIds: [...new Set(rawPhotos as string[])],
      idempotencyKey: input.idempotencyKey,
    },
  };
}

/**
 * The line shown after a check (spec §6.8). `disagreed` is true when one of the
 * check's definite answers differs from what the place said before it;
 * `counted` is false when the account is too new for the check to count yet.
 */
export function checkOutcome(
  before: { kind: string; progress?: number },
  after: { kind: string; progress?: number },
  placeName: string,
  options: { disagreed?: boolean; counted?: boolean } = {},
): string {
  if (options.counted === false) return "Thanks. Checks from new accounts start counting after 24 hours.";
  if (after.kind === "verified")
    return before.kind === "verified"
      ? `Your answers match the last two checks. ${placeName} stays Community verified.`
      : `Your answers match the last two checks. ${placeName} is now Community verified.`;
  if (after.kind === "checking") {
    if (options.disagreed) return "Your answers differ from recent checks. The place waits for 3 that match.";
    return after.progress === 2 ? "That’s 2 of 3. One more to verify." : "That’s 1 of 3. Two more matching checks verify it.";
  }
  return "Your check is in.";
}

/** True when any definite answer differs from the fact's value before this check. */
export function disagreesWith(
  answers: Record<"owned" | "certified" | "pork" | "alcohol", string | null>,
  previous: Record<"owned" | "certified" | "pork" | "alcohol", "yes" | "no" | null>,
): boolean {
  return (["owned", "certified", "pork", "alcohol"] as const).some((fact) => {
    const answer = answers[fact];
    return (answer === "yes" || answer === "no") && previous[fact] !== null && previous[fact] !== answer;
  });
}
