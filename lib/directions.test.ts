import { describe, expect, it } from "vitest";
import { directionsUrl, preferredMapsApp } from "./directions";

const place = { name: "Ali's & Sons", lat: 19.076, lng: 72.8777, address: "12 Main St, Mumbai" };

describe("directionsUrl", () => {
  it("uses coordinates for Google directions", () => {
    expect(directionsUrl("google", place)).toBe("https://www.google.com/maps/dir/?api=1&destination=19.076%2C72.8777");
  });

  it("uses coordinates and the place name for Apple directions", () => {
    expect(directionsUrl("apple", place)).toBe("https://maps.apple.com/?daddr=19.076%2C72.8777&q=Ali's%20%26%20Sons");
  });

  it("accepts zero coordinates", () => {
    expect(directionsUrl("google", { ...place, lat: 0, lng: 0 })).toBe("https://www.google.com/maps/dir/?api=1&destination=0%2C0");
  });

  it.each([{ lat: null, lng: null }, { lat: null, lng: 72.8777 }, { lat: 19.076, lng: null }])("falls back to name and address with incomplete coordinates: %j", (coords) => {
    expect(directionsUrl("google", { ...place, ...coords })).toBe("https://www.google.com/maps/dir/?api=1&destination=Ali's%20%26%20Sons%2C%2012%20Main%20St%2C%20Mumbai");
    expect(directionsUrl("apple", { ...place, ...coords })).toBe("https://maps.apple.com/?daddr=12%20Main%20St%2C%20Mumbai&q=Ali's%20%26%20Sons");
  });

  it.each(["google", "apple"] as const)("falls back to mapsUrl or null for %s without a location", (app) => {
    const missing = { name: "Cafe", lat: null, lng: null };
    expect(directionsUrl(app, { ...missing, mapsUrl: "https://maps.google.com/?cid=123" })).toBe("https://maps.google.com/?cid=123");
    expect(directionsUrl(app, missing)).toBeNull();
    expect(directionsUrl(app, { ...missing, address: "", mapsUrl: null })).toBeNull();
  });
});

describe("preferredMapsApp", () => {
  it.each(["iPhone", "iPad", "iPod"])("defaults to Apple Maps on %s", (device) => {
    expect(preferredMapsApp(null, `Mozilla/5.0 (${device}; CPU OS 18_0 like Mac OS X)`)).toBe("apple");
  });

  it.each(["", "Mozilla/5.0 (Linux; Android 15)", "Mozilla/5.0 (Macintosh; Intel Mac OS X)", "Mozilla/5.0 (Windows NT 10.0)"])("defaults to Google Maps for %s", (ua) => {
    expect(preferredMapsApp(null, ua)).toBe("google");
  });

  it("honours a saved choice over the device default", () => {
    expect(preferredMapsApp("google", "iPhone")).toBe("google");
    expect(preferredMapsApp("apple", "Android")).toBe("apple");
  });

  it("ignores invalid saved choices", () => {
    expect(preferredMapsApp("other", "iPad")).toBe("apple");
    expect(preferredMapsApp("APPLE", "Android")).toBe("google");
  });
});
