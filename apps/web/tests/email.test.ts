import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EMAIL_FROM,
  EmailError,
  sendEmail,
} from "../src/lib/email";
import { POST as emailHealthcheck } from "../app/api/admin/email/healthcheck/route";

const originalFetch = globalThis.fetch;
const environmentKeys = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_HEALTHCHECK_ENABLED",
  "EMAIL_HEALTHCHECK_TOKEN",
  "EMAIL_HEALTHCHECK_TO",
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]]),
);

function setEnvironment(values: Partial<Record<(typeof environmentKeys)[number], string | undefined>>) {
  for (const key of environmentKeys) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const emailInput = {
  to: ["ops@example.com"],
  subject: "Test email",
  html: "<p>Hello</p>",
  text: "Hello",
};

test("sendEmail posts a Worker-compatible Resend request", async () => {
  setEnvironment({ RESEND_API_KEY: "test-resend-key", EMAIL_FROM: undefined });
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (input, init) => {
    assert.equal(input, "https://api.resend.com/emails");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-resend-key");
    assert.equal(headers.get("content-type"), "application/json");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "resend-message-id" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  assert.deepEqual(await sendEmail(emailInput), { id: "resend-message-id" });
  assert.deepEqual(requestBody, {
    from: DEFAULT_EMAIL_FROM,
    to: ["ops@example.com"],
    subject: "Test email",
    html: "<p>Hello</p>",
    text: "Hello",
  });
});

test("sendEmail uses EMAIL_FROM when configured", async () => {
  setEnvironment({
    RESEND_API_KEY: "test-resend-key",
    EMAIL_FROM: "onboarding@resend.dev",
  });
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "resend-message-id" }));
  };

  await sendEmail(emailInput);
  assert.equal(requestBody?.from, "onboarding@resend.dev");
});

test("sendEmail fails clearly when the provider key is absent", async () => {
  setEnvironment({ RESEND_API_KEY: undefined });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };

  await assert.rejects(sendEmail(emailInput), (error: unknown) => {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, "CONFIGURATION_ERROR");
    return true;
  });
  assert.equal(called, false);
});

test("sendEmail exposes provider status without exposing credentials", async () => {
  setEnvironment({ RESEND_API_KEY: "do-not-leak-this-key" });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ name: "validation_error", message: "Invalid sender" }),
      { status: 422 },
    );

  await assert.rejects(sendEmail(emailInput), (error: unknown) => {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, "PROVIDER_ERROR");
    assert.equal(error.status, 422);
    assert.match(error.message, /Invalid sender/);
    assert.doesNotMatch(error.message, /do-not-leak-this-key/);
    return true;
  });
});

test("email healthcheck is 404 and never sends when disabled", async () => {
  setEnvironment({
    EMAIL_HEALTHCHECK_ENABLED: undefined,
    EMAIL_HEALTHCHECK_TOKEN: "healthcheck-token",
    EMAIL_HEALTHCHECK_TO: "ops@example.com",
  });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };

  const response = await emailHealthcheck(
    new Request("https://halalfood.world/api/admin/email/healthcheck", {
      method: "POST",
      headers: { Authorization: "Bearer healthcheck-token" },
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test("email healthcheck requires its bearer token", async () => {
  setEnvironment({
    RESEND_API_KEY: "test-resend-key",
    EMAIL_HEALTHCHECK_ENABLED: "true",
    EMAIL_HEALTHCHECK_TOKEN: "healthcheck-token",
    EMAIL_HEALTHCHECK_TO: "ops@example.com",
  });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ id: "unexpected" }));
  };

  const response = await emailHealthcheck(
    new Request("https://halalfood.world/api/admin/email/healthcheck", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("authorized email healthcheck sends only to configured recipient", async () => {
  setEnvironment({
    RESEND_API_KEY: "test-resend-key",
    EMAIL_HEALTHCHECK_ENABLED: "true",
    EMAIL_HEALTHCHECK_TOKEN: "healthcheck-token",
    EMAIL_HEALTHCHECK_TO: "ops@example.com",
    EMAIL_FROM: "onboarding@resend.dev",
  });
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "healthcheck-message-id" }));
  };

  const response = await emailHealthcheck(
    new Request("https://halalfood.world/api/admin/email/healthcheck", {
      method: "POST",
      headers: { Authorization: "Bearer healthcheck-token" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    id: "healthcheck-message-id",
  });
  assert.equal(requestBody?.to, "ops@example.com");
  assert.equal(requestBody?.from, "onboarding@resend.dev");
});
