import { requestHostname } from "./request-host";
import { isPreviewDeployment, readWorkerEnv } from "./worker-env";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/**
 * Preview versions (`ENVIRONMENT=preview` on a `*.workers.dev` host) inherit `RESEND_API_KEY` through `--keep-vars`. Mail is sent
 * on those hosts only when this separate key is set. Otherwise the OTP is
 * logged and Resend is not called.
 */
export const PREVIEW_RESEND_API_KEY_NAME = "PREVIEW_RESEND_API_KEY";

/** The preferred sender once halalfood.world is verified in Resend. */
export const DEFAULT_EMAIL_FROM = "noreply@halalfood.world";

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
  /** Request host. A preview version on `*.workers.dev` does not send through `RESEND_API_KEY`. */
  host?: string | null;
}

export type EmailErrorCode =
  | "CONFIGURATION_ERROR"
  | "INVALID_INPUT"
  | "PROVIDER_ERROR";

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

interface ResendResponse {
  id?: unknown;
  name?: unknown;
  message?: unknown;
}

function parseResponse(body: string): ResendResponse | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object")
      return parsed as ResendResponse;
  } catch {
    // Resend errors are still reported generically when the response is not JSON.
  }
  return undefined;
}

function normalizedRecipients(to: SendEmailInput["to"]): string | string[] {
  const values = Array.isArray(to) ? to : [to];
  if (
    values.length === 0 ||
    values.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    throw new EmailError(
      "INVALID_INPUT",
      "At least one recipient email address is required",
    );
  }

  const recipients = values.map((value) => value.trim());
  return Array.isArray(to) ? recipients : recipients[0];
}

function validateInput(input: SendEmailInput) {
  if (!input || typeof input !== "object") {
    throw new EmailError("INVALID_INPUT", "Email input is required");
  }
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

function logPreviewEmail(input: SendEmailInput, host: string): void {
  const to = Array.isArray(input.to) ? input.to.join(", ") : input.to;
  console.info(
    `[preview-mail] ${host} did not send email to ${to}. Subject: ${input.subject}\n${input.text}`,
  );
}

async function deliverWithResend(
  input: SendEmailInput,
  apiKey: string,
): Promise<SendEmailResult> {
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
  const to = normalizedRecipients(input.to);

  let response: Response;
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
  } catch {
    throw new EmailError(
      "PROVIDER_ERROR",
      "Unable to reach the email provider",
    );
  }

  let rawBody = "";
  try {
    rawBody = await response.text();
  } catch {
    throw new EmailError(
      "PROVIDER_ERROR",
      "Email provider returned an unreadable response",
      response.status,
    );
  }

  const payload = parseResponse(rawBody);
  if (!response.ok) {
    const providerMessage =
      payload && typeof payload.message === "string"
        ? payload.message.slice(0, 200)
        : "Request was rejected";
    throw new EmailError(
      "PROVIDER_ERROR",
      `Email provider rejected the request: ${providerMessage}`,
      response.status,
    );
  }

  if (!payload || typeof payload.id !== "string" || payload.id.trim() === "") {
    throw new EmailError(
      "PROVIDER_ERROR",
      "Email provider returned an invalid response",
      response.status,
    );
  }

  return { id: payload.id };
}

/**
 * Send one low-volume transactional email through Resend's REST API.
 *
 * This deliberately uses the platform fetch API so it can run in a Cloudflare
 * Worker without Node-only HTTP or SDK dependencies.
 *
 * On a preview version served from `*.workers.dev` (see `isPreviewDeployment`)
 * the production `RESEND_API_KEY` is not used. The production Worker on its
 * own workers.dev URLs still sends normally and never logs the message.
 * The message is logged (including a sign-in OTP in the text body) unless
 * `PREVIEW_RESEND_API_KEY` is set.
 */
export async function sendEmail(
  input: SendEmailInput,
  options?: SendEmailOptions,
): Promise<SendEmailResult> {
  validateInput(input);

  if (await isPreviewDeployment(options?.host)) {
    const previewKey = await readWorkerEnv(PREVIEW_RESEND_API_KEY_NAME);
    if (!previewKey) {
      logPreviewEmail(input, requestHostname(options?.host));
      return { id: "preview-not-sent" };
    }
    return deliverWithResend(input, previewKey);
  }

  const apiKey = await readWorkerEnv("RESEND_API_KEY");
  if (!apiKey) {
    throw new EmailError(
      "CONFIGURATION_ERROR",
      "Email provider is not configured",
    );
  }
  return deliverWithResend(input, apiKey);
}
