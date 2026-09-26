import {
  isSafeEvidenceR2Key,
  MAX_R2_UPLOAD_BYTES,
  R2_UPLOAD_CONTENT_TYPES,
  type R2UploadContentType,
} from "./r2";
import {
  DEFAULT_EVIDENCE_TTL_DAYS,
  isEvidenceKind,
  isEvidenceScope,
  isHalalTaxonomyStatus,
  isRelationship,
  type EvidenceKind,
  type EvidenceScope,
  type HalalTaxonomyStatus,
  type Relationship,
} from "./halal-taxonomy";

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

/**
 * Source attribution and scope travel with every submission. Nothing here is
 * optional in the product sense: a missing capture date or scope is filled with
 * an explicit, conservative default rather than left unknown.
 */
export type HalalVerificationAttributes = {
  kind: EvidenceKind;
  claimedStatus: HalalTaxonomyStatus;
  scope: EvidenceScope;
  scopeNote: string | null;
  certificationBody: string | null;
  certificateId: string | null;
  capturedAt: number;
  expiresAt: number;
  sourceUrl: string | null;
  relationship: Relationship;
  incentivized: boolean;
  visibility: "public" | "private";
};

export type ValidatedHalalVerification = {
  note: string | null;
  evidence: (HalalVerificationLinkEvidence | HalalVerificationUploadEvidence)[];
  answers: HalalCheckAnswers;
  attributes: HalalVerificationAttributes;
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

  const attributes = validateVerificationAttributes(input);
  if (!attributes.ok) return attributes;

  return {
    ok: true,
    data: { note, evidence, answers, attributes: attributes.data },
  };
}

const DAY_MS = 86_400_000;
const MAX_BACKDATE_MS = 10 * 365 * DAY_MS;

/** Any HTTPS origin, for "official website" and "restaurant statement" sources. */
export function validateSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

type AttributeResult =
  | { ok: true; data: HalalVerificationAttributes }
  | { ok: false; error: string };

/**
 * Scope, source, dates and disclosure. The defaults are the cautious ones: an
 * undeclared claim is `self-declared`, an undeclared scope is `venue` only
 * because the submitter is asked for it explicitly in the UI, and an undeclared
 * expiry falls back to the per-kind duration rather than to "never expires".
 */
export function validateVerificationAttributes(
  input: Record<string, unknown>,
  now: number = Date.now(),
): AttributeResult {
  const kind = input.evidenceKind ?? "first-hand";
  if (!isEvidenceKind(kind))
    return { ok: false, error: "Choose the type of evidence you are submitting." };

  const claimedStatus = input.claimedStatus ?? "self-declared";
  if (!isHalalTaxonomyStatus(claimedStatus))
    return { ok: false, error: "Choose what this evidence shows." };

  const scope = input.scope ?? "venue";
  if (!isEvidenceScope(scope))
    return { ok: false, error: "Declare what the evidence covers." };

  let scopeNote: string | null = null;
  if (input.scopeNote !== undefined && input.scopeNote !== null && input.scopeNote !== "") {
    const value = textValue(input.scopeNote, "scope note", 500);
    if (!value) return { ok: false, error: "The scope note must be 500 characters or fewer." };
    scopeNote = value;
  }
  if (
    (scope === "selected-dishes" || scope === "time-period" || scope === "meat-only") &&
    !scopeNote
  )
    return {
      ok: false,
      error: "Say exactly what this evidence covers, and any shared-kitchen constraints.",
    };

  let certificationBody: string | null = null;
  if (
    input.certificationBody !== undefined &&
    input.certificationBody !== null &&
    input.certificationBody !== ""
  ) {
    const value = textValue(input.certificationBody, "certification body", 120);
    if (!value) return { ok: false, error: "The certification body must be 120 characters or fewer." };
    certificationBody = value;
  }
  if (kind === "certification" && !certificationBody)
    return { ok: false, error: "Name the certification body shown on the certificate." };

  let certificateId: string | null = null;
  if (
    input.certificateId !== undefined &&
    input.certificateId !== null &&
    input.certificateId !== ""
  ) {
    const value = textValue(input.certificateId, "certificate id", 80);
    if (!value) return { ok: false, error: "The certificate identifier must be 80 characters or fewer." };
    certificateId = value;
  }

  let capturedAt = now;
  if (input.capturedAt !== undefined && input.capturedAt !== null) {
    if (
      typeof input.capturedAt !== "number" ||
      !Number.isFinite(input.capturedAt) ||
      input.capturedAt > now + DAY_MS ||
      input.capturedAt < now - MAX_BACKDATE_MS
    )
      return { ok: false, error: "The capture date is not plausible." };
    capturedAt = input.capturedAt;
  }

  let expiresAt = capturedAt + DEFAULT_EVIDENCE_TTL_DAYS[kind] * DAY_MS;
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    if (
      typeof input.expiresAt !== "number" ||
      !Number.isFinite(input.expiresAt) ||
      input.expiresAt <= capturedAt ||
      input.expiresAt > capturedAt + 10 * 365 * DAY_MS
    )
      return { ok: false, error: "The expiry date must be after the capture date." };
    expiresAt = input.expiresAt;
  }

  let sourceUrl: string | null = null;
  if (input.sourceUrl !== undefined && input.sourceUrl !== null && input.sourceUrl !== "") {
    sourceUrl = validateSourceUrl(input.sourceUrl);
    if (!sourceUrl) return { ok: false, error: "The source must be a valid HTTPS link." };
  }
  if (kind === "official-website" && !sourceUrl)
    return { ok: false, error: "Link the official page this claim comes from." };

  const relationship = input.relationship ?? "none";
  if (!isRelationship(relationship))
    return { ok: false, error: "Declare any relationship with the restaurant." };

  const visibility = input.visibility ?? "public";
  if (visibility !== "public" && visibility !== "private")
    return { ok: false, error: "Evidence visibility must be public or private." };

  return {
    ok: true,
    data: {
      kind,
      claimedStatus,
      scope,
      scopeNote,
      certificationBody,
      certificateId,
      capturedAt,
      expiresAt,
      sourceUrl,
      relationship,
      incentivized: input.incentivized === true,
      visibility,
    },
  };
}
