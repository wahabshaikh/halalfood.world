import { readBinding, isNonProductionRequest } from "./worker-env";
import { requestHostname } from "./request-host";

/** The production sender, onboarded in Email Service; Email Routing forwards mail to it to the maintainer. */
export const DEFAULT_EMAIL_FROM = "salam@halalfood.world";
export const EMAIL_FROM_NAME = "halalfood.world";

/** How long sink rows live; older ones are pruned on each write. */
export const EMAIL_SINK_TTL_MS = 24 * 60 * 60 * 1000;

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  id: string;
}

export interface SendEmailOptions {
  /** Request host. Non-production hosts (lib/environment.ts) write to the sink instead of sending. */
  host?: string | null;
}

export type EmailErrorCode = "CONFIGURATION_ERROR" | "INVALID_INPUT" | "PROVIDER_ERROR";

/** An operational error that callers can handle without exposing provider details. */
export class EmailError extends Error {
  constructor(
    public readonly code: EmailErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmailError";
  }
}

/** The subset of the `send_email` binding (Cloudflare Email Service) this module uses. */
export interface EmailBinding {
  send(message: {
    from: string | { email: string; name?: string };
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
  }): Promise<{ messageId: string }>;
}

/** The subset of D1 the sink uses. */
export interface SinkDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<unknown>; all<T>(): Promise<{ results?: T[] }> };
  };
  batch(statements: unknown[]): Promise<unknown>;
}

export type SinkedEmail = { id: string; to: string; subject: string; text: string; html: string | null; createdAt: number };

function recipients(to: SendEmailInput["to"]): string[] {
  const values = Array.isArray(to) ? to : [to];
  if (values.length === 0 || values.some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new EmailError("INVALID_INPUT", "At least one recipient email address is required");
  }
  return values.map((value) => value.trim());
}

function validateInput(input: SendEmailInput) {
  if (!input || typeof input !== "object") throw new EmailError("INVALID_INPUT", "Email input is required");
  if (typeof input.subject !== "string" || input.subject.trim() === "") {
    throw new EmailError("INVALID_INPUT", "Email subject is required");
  }
  if (typeof input.html !== "string" || input.html.trim() === "") {
    throw new EmailError("INVALID_INPUT", "HTML email content is required");
  }
  if (typeof input.text !== "string" || input.text.trim() === "") {
    throw new EmailError("INVALID_INPUT", "Text email content is required");
  }
}

/** Write one message per recipient to the sink and prune old rows. */
export async function writeToSink(
  database: SinkDatabase,
  input: SendEmailInput,
  host: string,
  now = Date.now(),
): Promise<SendEmailResult> {
  const id = crypto.randomUUID();
  const statements = recipients(input.to).map((to, index) =>
    database
      .prepare(`INSERT INTO email_sink (id, to_address, subject, text, html, host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(index === 0 ? id : crypto.randomUUID(), to.toLowerCase(), input.subject, input.text, input.html, host, now),
  );
  statements.push(database.prepare(`DELETE FROM email_sink WHERE created_at < ?`).bind(now - EMAIL_SINK_TTL_MS));
  await database.batch(statements);
  return { id: `sink:${id}` };
}

/** Newest first; `to` narrows to one recipient. */
export async function readSink(database: SinkDatabase, to: string | null, limit = 10): Promise<SinkedEmail[]> {
  const where = to ? "WHERE to_address = ?" : "";
  const values = to ? [to.trim().toLowerCase(), limit] : [limit];
  const rows = await database
    .prepare(`SELECT id, to_address AS "to", subject, text, html, created_at AS createdAt FROM email_sink ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values)
    .all<SinkedEmail>();
  return rows.results ?? [];
}

async function fromAddress(): Promise<string> {
  const configured = await readBinding<string>("EMAIL_FROM");
  const value = typeof configured === "string" ? configured.trim() : process.env.EMAIL_FROM?.trim();
  return value || DEFAULT_EMAIL_FROM;
}

/** Send through the Email Service binding. */
export async function deliver(binding: EmailBinding, input: SendEmailInput, from: string): Promise<SendEmailResult> {
  const to = recipients(input.to);
  try {
    const result = await binding.send({
      from: { email: from, name: EMAIL_FROM_NAME },
      to: Array.isArray(input.to) ? to : to[0],
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (!result || typeof result.messageId !== "string" || !result.messageId) {
      throw new EmailError("PROVIDER_ERROR", "Email provider returned an invalid response");
    }
    return { id: result.messageId };
  } catch (error) {
    if (error instanceof EmailError) throw error;
    const detail = error instanceof Error ? error.message.slice(0, 200) : "Request was rejected";
    throw new EmailError("PROVIDER_ERROR", `Email provider rejected the request: ${detail}`);
  }
}

/**
 * Send one low-volume transactional email through Cloudflare Email Service (the `EMAIL` binding).
 *
 * On a non-production host (localhost or a Worker Preview, see `lib/environment.ts`) nothing is sent:
 * the message, including a sign-in code, goes to the `email_sink` table, readable at
 * `GET /api/test/emails?to=`. Previews have no `EMAIL` binding at all, so they cannot send even by
 * mistake.
 */
export async function sendEmail(input: SendEmailInput, options?: SendEmailOptions): Promise<SendEmailResult> {
  validateInput(input);

  if (await isNonProductionRequest(options?.host)) {
    const database = await readBinding<SinkDatabase>("DB");
    const host = requestHostname(options?.host);
    if (!database) {
      console.info(`[email-sink] ${host}: ${input.subject}\n${input.text}`);
      return { id: "sink:logged" };
    }
    return writeToSink(database, input, host);
  }

  const binding = await readBinding<EmailBinding>("EMAIL");
  if (!binding || typeof binding.send !== "function") {
    throw new EmailError("CONFIGURATION_ERROR", "Email provider is not configured");
  }
  return deliver(binding, input, await fromAddress());
}
