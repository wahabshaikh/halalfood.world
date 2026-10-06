import assert from "node:assert/strict";
import { env } from "cloudflare:workers";
import { afterEach, test } from "vitest";
import { POST as emailHealthcheck } from "@/app/api/admin/email/healthcheck/route";
import { createTestDatabase } from "@/lib/testing/sqlite-d1";
import { DEFAULT_EMAIL_FROM, EMAIL_SINK_TTL_MS, EmailError, readSink, sendEmail, writeToSink, type EmailBinding, type SinkDatabase } from "./email";

const environmentKeys = ["ENVIRONMENT", "EMAIL_FROM", "EMAIL_HEALTHCHECK_ENABLED", "EMAIL_HEALTHCHECK_TOKEN", "EMAIL_HEALTHCHECK_TO"] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const bindings = env as Record<string, unknown>;

function setEnvironment(values: Partial<Record<(typeof environmentKeys)[number], string | undefined>>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  delete bindings.EMAIL;
  delete bindings.DB;
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

type Sent = Parameters<EmailBinding["send"]>[0];

function fakeEmail(result: unknown = { messageId: "cf-message-id" }) {
  const sent: Sent[] = [];
  const binding: EmailBinding = {
    async send(message) {
      sent.push(message);
      if (result instanceof Error) throw result;
      return result as { messageId: string };
    },
  };
  bindings.EMAIL = binding;
  return sent;
}

function sinkDatabase() {
  const { binding } = createTestDatabase();
  bindings.DB = binding;
  return binding as unknown as SinkDatabase;
}

const emailInput = { to: ["ops@example.com"], subject: "Test email", html: "<p>Hello</p>", text: "Hello" };
const PRODUCTION = "halalfood.world";
const PREVIEW = "my-branch-halalfood-world.wahabshaikh.workers.dev";

test("production sends through the Email Service binding from the default sender", async () => {
  setEnvironment({ ENVIRONMENT: "production", EMAIL_FROM: undefined });
  const sent = fakeEmail();
  assert.deepEqual(await sendEmail(emailInput, { host: PRODUCTION }), { id: "cf-message-id" });
  assert.deepEqual(sent, [
    { from: { email: DEFAULT_EMAIL_FROM, name: "halalfood.world" }, to: ["ops@example.com"], subject: "Test email", html: "<p>Hello</p>", text: "Hello" },
  ]);
});

test("EMAIL_FROM overrides the sender and a single recipient stays a string", async () => {
  setEnvironment({ ENVIRONMENT: "production", EMAIL_FROM: " team@halalfood.world " });
  const sent = fakeEmail();
  await sendEmail({ ...emailInput, to: " a@example.com " }, { host: PRODUCTION });
  assert.deepEqual(sent[0]?.from, { email: "team@halalfood.world", name: "halalfood.world" });
  assert.equal(sent[0]?.to, "a@example.com");
});

test("production fails clearly when the EMAIL binding is missing", async () => {
  setEnvironment({ ENVIRONMENT: "production" });
  await assert.rejects(sendEmail(emailInput, { host: PRODUCTION }), (error: unknown) => error instanceof EmailError && error.code === "CONFIGURATION_ERROR");
});

test("a rejected send becomes a provider error with a short message", async () => {
  setEnvironment({ ENVIRONMENT: "production" });
  fakeEmail(new Error("sender not verified"));
  await assert.rejects(
    sendEmail(emailInput, { host: PRODUCTION }),
    (error: unknown) => error instanceof EmailError && error.code === "PROVIDER_ERROR" && /sender not verified/.test(error.message),
  );
  fakeEmail({});
  await assert.rejects(sendEmail(emailInput, { host: PRODUCTION }), /invalid response/);
});

test("input is validated before anything is sent", async () => {
  const sent = fakeEmail();
  await assert.rejects(sendEmail({ ...emailInput, to: [] }, { host: PRODUCTION }), /recipient/);
  await assert.rejects(sendEmail({ ...emailInput, subject: " " }, { host: PRODUCTION }), /subject/);
  await assert.rejects(sendEmail({ ...emailInput, html: "" }, { host: PRODUCTION }), /HTML/);
  await assert.rejects(sendEmail({ ...emailInput, text: "" }, { host: PRODUCTION }), /Text/);
  assert.equal(sent.length, 0);
});

test("a Worker Preview writes to the sink and never calls the binding", async () => {
  setEnvironment({ ENVIRONMENT: "preview" });
  const sent = fakeEmail();
  const database = sinkDatabase();
  const result = await sendEmail({ ...emailInput, to: "Someone@Example.com", text: "Your code is 123456" }, { host: PREVIEW });
  assert.match(result.id, /^sink:/);
  assert.equal(sent.length, 0);
  const [mail] = await readSink(database, "someone@example.com");
  assert.equal(mail?.text, "Your code is 123456");
  assert.equal(mail?.subject, "Test email");
});

test("localhost writes to the sink even though the deployment says production", async () => {
  setEnvironment({ ENVIRONMENT: "production" });
  const sent = fakeEmail();
  const database = sinkDatabase();
  await sendEmail(emailInput, { host: "127.0.0.1:5173" });
  assert.equal(sent.length, 0);
  assert.equal((await readSink(database, null)).length, 1);
});

test("halalfood.world and the production workers.dev URL always send for real", async () => {
  for (const [environment, host] of [["preview", PRODUCTION], ["production", "halalfood-world.wahabshaikh.workers.dev"]] as const) {
    setEnvironment({ ENVIRONMENT: environment });
    const sent = fakeEmail();
    sinkDatabase();
    await sendEmail(emailInput, { host });
    assert.equal(sent.length, 1, host);
  }
});

test("the sink prunes rows older than a day", async () => {
  const { binding } = createTestDatabase();
  const database = binding as unknown as SinkDatabase;
  const now = Date.now();
  await writeToSink(database, { ...emailInput, subject: "old" }, "localhost", now - EMAIL_SINK_TTL_MS - 1);
  await writeToSink(database, { ...emailInput, subject: "new" }, "localhost", now);
  assert.deepEqual((await readSink(database, "ops@example.com")).map((mail) => mail.subject), ["new"]);
});

test("email healthcheck is 404 and never sends when disabled", async () => {
  setEnvironment({ EMAIL_HEALTHCHECK_ENABLED: undefined, EMAIL_HEALTHCHECK_TOKEN: "healthcheck-token", EMAIL_HEALTHCHECK_TO: "ops@example.com" });
  const sent = fakeEmail();
  const response = await emailHealthcheck(
    new Request("https://halalfood.world/api/admin/email/healthcheck", { method: "POST", headers: { Authorization: "Bearer healthcheck-token" } }),
  );
  assert.equal(response.status, 404);
  assert.equal(sent.length, 0);
});

test("email healthcheck requires its bearer token", async () => {
  setEnvironment({ EMAIL_HEALTHCHECK_ENABLED: "true", EMAIL_HEALTHCHECK_TOKEN: "healthcheck-token", EMAIL_HEALTHCHECK_TO: "ops@example.com" });
  const sent = fakeEmail();
  const response = await emailHealthcheck(new Request("https://halalfood.world/api/admin/email/healthcheck", { method: "POST" }));
  assert.equal(response.status, 401);
  assert.equal(sent.length, 0);
});

test("authorized email healthcheck sends only to the configured recipient", async () => {
  setEnvironment({ ENVIRONMENT: "production", EMAIL_HEALTHCHECK_ENABLED: "true", EMAIL_HEALTHCHECK_TOKEN: "healthcheck-token", EMAIL_HEALTHCHECK_TO: "ops@example.com" });
  const sent = fakeEmail({ messageId: "healthcheck-message-id" });
  const response = await emailHealthcheck(
    new Request("https://halalfood.world/api/admin/email/healthcheck", { method: "POST", headers: { Authorization: "Bearer healthcheck-token" } }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: "healthcheck-message-id" });
  assert.equal(sent[0]?.to, "ops@example.com");
});
