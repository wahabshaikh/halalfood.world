import { INVALID_JSON, badRequest, json, readJson, requireUser, unavailable } from "@/lib/api";
import { ensureProfile, markOnboarded } from "@/lib/profiles";

const STEPS = ["profile", "filters", "done"] as const;

/** Body `{step}`. Only `done` changes anything: it sets `onboarded_at`. */
export async function POST(request: Request): Promise<Response> {
  const outcome = await requireUser(request, "/welcome");
  if (!outcome.ok) return outcome.response;
  const body = await readJson(request);
  if (body === INVALID_JSON) return badRequest("Send a valid JSON object.");
  const step = (body as { step?: unknown } | null)?.step;
  if (!STEPS.includes(step as (typeof STEPS)[number])) return badRequest("Unknown step.");
  try {
    await ensureProfile(outcome.auth.userId);
    if (step === "done") await markOnboarded(outcome.auth.userId);
    return json({ step });
  } catch {
    return unavailable();
  }
}
