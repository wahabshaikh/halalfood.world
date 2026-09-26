import { EmailError, sendEmail } from "../../../../../src/lib/email";

function environmentValue(name: string) {
  return process.env[name]?.trim() || "";
}

function notFound() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

/**
 * Explicitly gated smoke check for operators. The recipient is configured in
 * the environment so callers cannot turn this into an arbitrary-send endpoint.
 */
export async function POST(request: Request) {
  if (environmentValue("EMAIL_HEALTHCHECK_ENABLED").toLowerCase() !== "true")
    return notFound();

  const token = environmentValue("EMAIL_HEALTHCHECK_TOKEN");
  const recipient = environmentValue("EMAIL_HEALTHCHECK_TO");
  if (!token || !recipient) {
    return Response.json(
      { error: "Email healthcheck is not configured" },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendEmail({
      to: recipient,
      subject: "halalfood.world email healthcheck",
      html: "<p>This is a halalfood.world email delivery healthcheck.</p>",
      text: "This is a halalfood.world email delivery healthcheck.",
    });
    return Response.json({ ok: true, id: result.id });
  } catch (error) {
    const status =
      error instanceof EmailError && error.code === "CONFIGURATION_ERROR"
        ? 503
        : 502;
    return Response.json({ error: "Email healthcheck failed" }, { status });
  }
}
