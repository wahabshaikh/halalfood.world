import assert from "node:assert/strict";
import { test } from "vitest";
import {
  channelUrl,
  creatorHandle,
  creatorImageUrl,
  formatSubscriberCount,
  formatVideoTimestamp,
  isChannelId,
  isUndeliverableEmail,
  normalizeChannelUrl,
  parseVideoDate,
  parseVideoTimestamp,
  unclaimedCreatorEmail,
  youtubeThumbnailUrl,
  youtubeVideoId,
  youtubeWatchUrl,
  youtubeWatchUrlAt,
} from "./creators";

const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

test("a YouTube handle becomes a profile handle, or a clear error", () => {
  assert.deepEqual(creatorHandle("@HalalFoodie"), { ok: true, handle: "halalfoodie" });
  assert.deepEqual(creatorHandle("eats.with.sara"), { ok: true, handle: "eats.with.sara" });
  assert.deepEqual(creatorHandle("https://www.youtube.com/@Tandoori_Trail/videos"), { ok: true, handle: "tandoori_trail" });
  const hyphen = creatorHandle("@halal-food-uk");
  assert.equal(hyphen.ok, false);
  assert.match(!hyphen.ok ? hyphen.error : "", /hyphen/);
  assert.equal(creatorHandle("ab").ok, false);
  assert.equal(creatorHandle("admin").ok, false);
  assert.equal(creatorHandle("_underscore").ok, false);
  assert.equal(creatorHandle(42).ok, false);
});

test("channel ids, URLs and images", () => {
  assert.equal(isChannelId(CHANNEL), true);
  assert.equal(isChannelId("UCshort"), false);
  assert.equal(isChannelId(null), false);
  assert.equal(channelUrl(CHANNEL, "halalfoodie"), "https://www.youtube.com/@halalfoodie");
  assert.equal(channelUrl(CHANNEL), `https://www.youtube.com/channel/${CHANNEL}`);
  assert.equal(normalizeChannelUrl("https://m.youtube.com/@HalalFoodie/"), "https://www.youtube.com/@HalalFoodie");
  assert.equal(normalizeChannelUrl(`https://youtube.com/channel/${CHANNEL}`), `https://www.youtube.com/channel/${CHANNEL}`);
  assert.equal(normalizeChannelUrl("https://www.youtube.com/c/Some.Name"), "https://www.youtube.com/c/Some.Name");
  assert.equal(normalizeChannelUrl("http://www.youtube.com/@x"), null);
  assert.equal(normalizeChannelUrl("https://evil.example/@x"), null);
  assert.equal(normalizeChannelUrl("https://www.youtube.com/watch?v=abc"), null);
  assert.equal(normalizeChannelUrl("not a url"), null);
  assert.equal(normalizeChannelUrl(5), null);
  assert.equal(creatorImageUrl("https://yt3.ggpht.com/abc=s176"), "https://yt3.ggpht.com/abc=s176");
  assert.equal(creatorImageUrl("https://yt3.googleusercontent.com/banner=w1060"), "https://yt3.googleusercontent.com/banner=w1060");
  assert.equal(creatorImageUrl("http://yt3.ggpht.com/abc"), null);
  assert.equal(creatorImageUrl("https://yt3.ggpht.com.evil.example/abc"), null);
  assert.equal(creatorImageUrl("https://169.254.169.254/latest"), null);
  assert.equal(creatorImageUrl("https://user:pw@yt3.ggpht.com/a"), null);
  assert.equal(creatorImageUrl("nope"), null);
  assert.equal(creatorImageUrl(undefined), null);
});

test("unclaimed creators get an address that can never receive mail", () => {
  const email = unclaimedCreatorEmail("1234");
  assert.equal(email, "creator-1234@unclaimed.invalid");
  assert.equal(isUndeliverableEmail(email), true);
  assert.equal(isUndeliverableEmail("Creator-1@UNCLAIMED.INVALID "), true);
  assert.equal(isUndeliverableEmail("deleted-1@deleted.invalid"), true);
  assert.equal(isUndeliverableEmail("a@invalid"), true);
  assert.equal(isUndeliverableEmail("sara@example.com"), false);
  assert.equal(isUndeliverableEmail("sara@invalid.example.com"), false);
  assert.equal(isUndeliverableEmail(null), false);
});

test("video links normalise to one canonical watch URL", () => {
  const id = "dQw4w9WgXcQ";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}&t=83s`,
    `https://youtu.be/${id}?t=10`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    id,
  ])
    assert.equal(youtubeVideoId(url), id, url);
  for (const url of ["https://vimeo.com/123", "https://www.youtube.com/@channel", "https://www.youtube.com/watch?v=short", "ftp://youtu.be/dQw4w9WgXcQ", "x", 7])
    assert.equal(youtubeVideoId(url), null, String(url));
  assert.equal(youtubeWatchUrl(id), `https://www.youtube.com/watch?v=${id}`);
  assert.equal(youtubeWatchUrlAt(id, 83), `https://www.youtube.com/watch?v=${id}&t=83s`);
  assert.equal(youtubeWatchUrlAt(id, null), youtubeWatchUrl(id));
  assert.equal(youtubeThumbnailUrl(id), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
});

test("timestamps accept seconds and clock forms", () => {
  assert.deepEqual(parseVideoTimestamp(83), { ok: true, seconds: 83 });
  assert.deepEqual(parseVideoTimestamp("83"), { ok: true, seconds: 83 });
  assert.deepEqual(parseVideoTimestamp("83s"), { ok: true, seconds: 83 });
  assert.deepEqual(parseVideoTimestamp("1:23"), { ok: true, seconds: 83 });
  assert.deepEqual(parseVideoTimestamp("1:02:03"), { ok: true, seconds: 3723 });
  assert.deepEqual(parseVideoTimestamp("1h2m3s"), { ok: true, seconds: 3723 });
  assert.deepEqual(parseVideoTimestamp("2m"), { ok: true, seconds: 120 });
  assert.deepEqual(parseVideoTimestamp(undefined), { ok: true, seconds: null });
  assert.deepEqual(parseVideoTimestamp(""), { ok: true, seconds: null });
  for (const bad of ["1:75", "1:60:00", "abc", "s", 1.5, -1, 13 * 3600, {}]) assert.equal(parseVideoTimestamp(bad).ok, false, String(bad));
  assert.equal(formatVideoTimestamp(83), "1:23");
  assert.equal(formatVideoTimestamp(3723), "1:02:03");
  assert.equal(formatVideoTimestamp(5), "0:05");
});

test("video dates are real ISO dates, not in the future", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.deepEqual(parseVideoDate("2026-03-01", now), { ok: true, date: "2026-03-01" });
  assert.deepEqual(parseVideoDate("2026-03-01T10:00:00Z", now), { ok: true, date: "2026-03-01" });
  assert.deepEqual(parseVideoDate("2026-03-01T10:00:00+05:30", now), { ok: true, date: "2026-03-01" });
  assert.deepEqual(parseVideoDate(null, now), { ok: true, date: null });
  for (const bad of ["2026-02-30", "01/03/2026", "2004-12-31", "2027-01-01", 20260301])
    assert.equal(parseVideoDate(bad, now).ok, false, String(bad));
});

test("subscriber counts read like YouTube's", () => {
  assert.equal(formatSubscriberCount(980), "980");
  assert.equal(formatSubscriberCount(1_250), "1.2K");
  assert.equal(formatSubscriberCount(45_000), "45K");
  assert.equal(formatSubscriberCount(123_456), "123K");
  assert.equal(formatSubscriberCount(1_250_000), "1.2M");
});
