import { test } from "vitest";
import assert from "node:assert/strict";
import { atomFeed, csvField, toCsv } from "./export";

test("CSV fields are quoted when needed and formulas are defused", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField(null), "");
  assert.equal(csvField(3), "3");
  assert.equal(csvField('Room 1, "B"'), '"Room 1, ""B"""');
  assert.equal(csvField("line\nbreak"), '"line\nbreak"');
  assert.equal(csvField("=HYPERLINK()"), "'=HYPERLINK()");
  assert.equal(csvField("-1"), "'-1");
  assert.equal(toCsv(["a", "b"], [["1", null]]), "a,b\r\n1,\r\n");
});

test("the Atom feed escapes text and carries every entry", () => {
  const xml = atomFeed({
    id: "https://halalfood.world/certifiers/changes",
    title: "Changes & updates",
    selfLink: "https://halalfood.world/certifiers/changes.xml",
    htmlLink: "https://halalfood.world/certifiers/changes",
    updated: new Date(Date.UTC(2026, 9, 17)),
    entries: [{ id: "urn:x:1", title: "<Renamed>", summary: "A → B", link: "https://halalfood.world/certifiers/b", updated: new Date(Date.UTC(2026, 9, 17)) }],
  });
  assert.match(xml, /^<\?xml version="1.0"/);
  assert.match(xml, /<title>Changes &amp; updates<\/title>/);
  assert.match(xml, /<title>&lt;Renamed&gt;<\/title>/);
  assert.match(xml, /<updated>2026-10-17T00:00:00.000Z<\/updated>/);
  assert.equal(xml.match(/<entry>/g)?.length, 1);
});
