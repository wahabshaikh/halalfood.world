import {
  isSafeEvidenceR2Key,
  MAX_R2_UPLOAD_BYTES,
  R2_UPLOAD_CONTENT_TYPES,
  type R2UploadContentType,
} from "./r2";

export const HALAL_VERIFICATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
export type HalalVerificationStatus = (typeof HALAL_VERIFICATION_STATUSES)[number];

export type HalalVerificationLinkEvidence = {
  kind: "link";
  url: string;
};

export type HalalVerificationUploadEvidence = {
  kind: "upload";
  key: string;
  contentType: R2UploadContentType;
  sizeBytes: number;
  fileName: string;
};

/** Fixed choices from the step-by-step check. `null` means not asked or skipped. */
export const HALAL_CHECK_ANSWER_VALUES = {
  certificate: ["seen", "not-seen", "unsure"],
  alcohol: ["none", "served", "unsure"],
  meat: ["hand", "machine", "unsure"],
} as const;

export type HalalCheckQuestion = keyof typeof HALAL_CHECK_ANSWER_VALUES;

export type HalalCheckAnswers = {
  [Question in HalalCheckQuestion]: (typeof HALAL_CHECK_ANSWER_VALUES)[Question][number] | null;
};

export const EMPTY_HALAL_CHECK_ANSWERS: HalalCheckAnswers = {
  certificate: null,
  alcohol: null,
  meat: null,
};

export type ValidatedHalalVerification = {
  note: string | null;
  evidence: (HalalVerificationLinkEvidence | HalalVerificationUploadEvidence)[];
  answers: HalalCheckAnswers;
};

export type HalalVerificationValidationResult =
  | { ok: true; data: ValidatedHalalVerification }
  | { ok: false; error: string };

const MAX_EVIDENCE_ITEMS = 8;
const MAX_NOTE_LENGTH = 1000;
const MAX_FILE_NAME_LENGTH = 160;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown, label: string, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function allowedHostPath(host: string, path: string): boolean {
  if (path.length <= 1 || path.includes("\\")) return false;
  if (["zabihah.com", "www.zabihah.com"].includes(host)) return true;
  if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host))
    return true;
  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(host))
    return true;
  if (host === "youtu.be") return true;
  if (host === "youtube.com" || host === "www.youtube.com")
    return /\/(?:watch|shorts|embed|live|channel|user|@)[^/]*(?:\/.*)?$/i.test(path);
  return false;
}

/** Only accept HTTPS links from the evidence platforms shown in the UI. */
export function validateHalalEvidenceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !allowedHostPath(url.hostname.toLowerCase(), url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function uploadContentType(value: unknown): value is R2UploadContentType {
  return (
    typeof value === "string" &&
    (R2_UPLOAD_CONTENT_TYPES as readonly string[]).includes(value)
  );
}

function uploadFileName(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const fileName = value.trim();
  if (
    fileName.length > MAX_FILE_NAME_LENGTH ||
    /[\u0000-\u001f\u007f/\\]/.test(fileName)
  )
    return null;
  return fileName;
}

/** True when at least one answer says something other than "not sure". */
export function hasInformativeAnswer(answers: HalalCheckAnswers): boolean {
  return Object.values(answers).some((value) => value !== null && value !== "unsure");
}

function parseAnswers(
  value: unknown,
): { ok: true; answers: HalalCheckAnswers } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, answers: { ...EMPTY_HALAL_CHECK_ANSWERS } };
  const input = objectValue(value);
  if (!input) return { ok: false, error: "Check answers must be an object." };
  const answers: HalalCheckAnswers = { ...EMPTY_HALAL_CHECK_ANSWERS };
  for (const key of Object.keys(input)) {
    if (!(key in HALAL_CHECK_ANSWER_VALUES))
      return { ok: false, error: "That check question is not recognised." };
  }
  for (const question of Object.keys(HALAL_CHECK_ANSWER_VALUES) as HalalCheckQuestion[]) {
    const answer = input[question];
    if (answer === undefined || answer === null) continue;
    const allowed = HALAL_CHECK_ANSWER_VALUES[question] as readonly string[];
    if (typeof answer !== "string" || !allowed.includes(answer))
      return { ok: false, error: "Choose one of the listed answers." };
    (answers as Record<HalalCheckQuestion, string | null>)[question] = answer;
  }
  return { ok: true, answers };
}

/** Validate the JSON contract used by POST /api/places/:id/verifications. */
export function validateHalalVerificationSubmission(
  body: unknown,
): HalalVerificationValidationResult {
  const input = objectValue(body);
  if (!input) return { ok: false, error: "Send a JSON object." };

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null && input.note !== "") {
    const value = textValue(input.note, "verification note", MAX_NOTE_LENGTH);
    if (!value)
      return {
        ok: false,
        error: `Verification note must be ${MAX_NOTE_LENGTH} characters or fewer.`,
      };
    note = value;
  }

  const parsedAnswers = parseAnswers(input.answers);
  if (!parsedAnswers.ok) return parsedAnswers;
  const answers = parsedAnswers.answers;

  const rawEvidence = input.evidence === undefined ? [] : input.evidence;
  if (!Array.isArray(rawEvidence))
    return { ok: false, error: "Evidence must be a list." };
  // A check needs either something you saw (an answer) or a source to review.
  if (rawEvidence.length < 1 && !hasInformativeAnswer(answers))
    return {
      ok: false,
      error: "Answer at least one question or add a halal evidence link or upload.",
    };
  if (rawEvidence.length > MAX_EVIDENCE_ITEMS)
    return { ok: false, error: `Add no more than ${MAX_EVIDENCE_ITEMS} evidence items.` };

  const seen = new Set<string>();
  const evidence: ValidatedHalalVerification["evidence"] = [];
  for (const value of rawEvidence) {
    const item = objectValue(value);
    if (!item || (item.kind !== "link" && item.kind !== "upload"))
      return { ok: false, error: "Each evidence item must be a link or upload." };

    if (item.kind === "link") {
      const url = validateHalalEvidenceUrl(item.url);
      if (!url)
        return {
          ok: false,
          error: "Use a valid HTTPS Zabihah, Instagram, TikTok, or YouTube link.",
        };
      if (seen.has(`link:${url}`))
        return { ok: false, error: "Remove duplicate evidence links." };
      seen.add(`link:${url}`);
      evidence.push({ kind: "link", url });
      continue;
    }

    const key = item.key;
    const contentType = item.contentType;
    const sizeBytes = item.sizeBytes;
    const fileName = uploadFileName(item.fileName);
    if (
      !isSafeEvidenceR2Key(key) ||
      !uploadContentType(contentType) ||
      !fileName ||
      typeof sizeBytes !== "number" ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > MAX_R2_UPLOAD_BYTES
    )
      return { ok: false, error: "That evidence upload is invalid." };
    if (seen.has(`upload:${key}`))
      return { ok: false, error: "Remove duplicate evidence uploads." };
    seen.add(`upload:${key}`);
    evidence.push({ kind: "upload", key, contentType, sizeBytes, fileName });
  }

  return { ok: true, data: { note, evidence, answers } };
}
