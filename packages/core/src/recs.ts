/**
 * Recommendations between friends: a place or a list, an optional note and a
 * quick reply. There is deliberately no free chat: a note is one short line
 * that travels with the card, and the reply is one of two fixed answers, so
 * there is nothing open-ended to moderate.
 *
 * A rec is taste, not evidence. It never changes a place's halal status, and
 * the recipient's own dietary standard still decides whether a place is shown.
 */

export const MAX_REC_NOTE_LENGTH = 140;
export const MAX_REC_RECIPIENTS = 10;

/** The two answers on a rec card, "I'm in" and "Want to try". */
export const REC_REPLIES = ["in", "want-to-try"] as const;
export type RecReply = (typeof REC_REPLIES)[number];

export const REC_REPLY_LABELS: Record<RecReply, string> = {
  in: "I’m in",
  "want-to-try": "Want to try",
};

export function isRecReply(value: unknown): value is RecReply {
  return (REC_REPLIES as readonly unknown[]).includes(value);
}

export type RecTarget = { kind: "place"; id: string } | { kind: "list"; id: string };

export type ValidatedRec = {
  target: RecTarget;
  /** Lower-case handles, without duplicates. */
  recipients: string[];
  note: string | null;
};

export type RecValidation = { ok: true; rec: ValidatedRec } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

/** Trim a note to plain single-paragraph text. Null when empty. */
export function cleanRecNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string") return { ok: false, error: "Write the note as text." };
  const note = value.replace(/\s+/g, " ").trim();
  if (!note) return { ok: true, note: null };
  if (note.length > MAX_REC_NOTE_LENGTH)
    return { ok: false, error: `Notes can be up to ${MAX_REC_NOTE_LENGTH} characters.` };
  if (/[\u0000-\u001f\u007f]/.test(note))
    return { ok: false, error: "That note contains characters we can’t show." };
  return { ok: true, note };
}

/**
 * Validate a send request: exactly one of `placeId` or `listId`, one to ten
 * handles, and an optional note.
 */
export function validateRec(input: unknown): RecValidation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "Send a JSON object." };
  const body = input as Record<string, unknown>;

  const hasPlace = body.placeId !== undefined && body.placeId !== null;
  const hasList = body.listId !== undefined && body.listId !== null;
  if (hasPlace === hasList) return { ok: false, error: "Send either a place or a list." };
  const id = String(hasPlace ? body.placeId : body.listId);
  if (!UUID.test(id)) return { ok: false, error: `That ${hasPlace ? "place" : "list"} id is not valid.` };

  if (!Array.isArray(body.recipients) || !body.recipients.length)
    return { ok: false, error: "Pick at least one friend." };
  const recipients: string[] = [];
  for (const raw of body.recipients) {
    const handle = typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
    if (!HANDLE.test(handle)) return { ok: false, error: "One of those handles is not valid." };
    if (!recipients.includes(handle)) recipients.push(handle);
  }
  if (recipients.length > MAX_REC_RECIPIENTS)
    return { ok: false, error: `Send to at most ${MAX_REC_RECIPIENTS} friends at a time.` };

  const note = cleanRecNote(body.note);
  if (!note.ok) return note;

  return {
    ok: true,
    rec: {
      target: hasPlace ? { kind: "place", id } : { kind: "list", id },
      recipients,
      note: note.note,
    },
  };
}

/** A reply is one of the two fixed answers. */
export function validateRecReply(input: unknown): { ok: true; reply: RecReply } | { ok: false; error: string } {
  const reply =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).reply
      : undefined;
  return isRecReply(reply)
    ? { ok: true, reply }
    : { ok: false, error: "Reply with “I’m in” or “Want to try”." };
}

/**
 * Who may send to whom. Recs go to people the sender follows, or who follow
 * the sender, and never across a block. That keeps a stranger from filling
 * someone's inbox, without asking for a mutual follow.
 */
export function canSendRec(input: {
  senderId: string;
  recipientId: string;
  senderFollowsRecipient: boolean;
  recipientFollowsSender: boolean;
  blockedEitherWay: boolean;
}): boolean {
  if (input.senderId === input.recipientId) return false;
  if (input.blockedEitherWay) return false;
  return input.senderFollowsRecipient || input.recipientFollowsSender;
}

/** The link that goes in a WhatsApp message or the clipboard. It is a public page. */
export function recShareUrl(target: RecTarget, origin = "https://halalfood.world"): string {
  return `${origin}/${target.kind === "place" ? "place" : "list"}/${target.id}`;
}

export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`.trim())}`;
}
