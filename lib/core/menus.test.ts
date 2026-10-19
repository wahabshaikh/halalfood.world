import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MAX_MENU_ITEMS,
  MENU_BADGE_LABEL,
  MENU_BADGE_TOOLTIP,
  formatMenuPrice,
  groupMenuItems,
  httpsLogoUrl,
  isCurrencyCode,
  menuCheckFacts,
  normalizeMenu,
  normalizeMenuCheck,
  parseCapturedAt,
  parseMenuCheckStatus,
  parseMenuSourceType,
  parsePrice,
  previewMenu,
  sameMenu,
  showsMenuBadge,
  type MenuItemInput,
} from "./menus";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const SOURCE = { url: "https://example.com/menu", type: "website" };
const item = (over: Partial<MenuItemInput> = {}): MenuItemInput => ({ name: "Lamb biryani", price: 14.5, ...over });

test("currencies are three capital letters the runtime knows", () => {
  for (const code of ["GBP", "INR", "USD", "JPY", "KWD"]) assert.equal(isCurrencyCode(code), true, code);
  for (const code of ["gbp", "GB", "GBPX", "£", "", 826, null, "ZZZ"]) assert.equal(isCurrencyCode(code), false, String(code));
});

test("prices are finite, zero or more, and rounded to three decimals", () => {
  assert.equal(parsePrice(0), 0);
  assert.equal(parsePrice(12.5), 12.5);
  assert.equal(parsePrice(1.23456), 1.235);
  for (const bad of [-0.01, Number.NaN, Infinity, 20_000_000, "12", null]) assert.equal(parsePrice(bad), null, String(bad));
});

test("normalizeMenu keeps order, applies the menu currency and tidies text", () => {
  const out = normalizeMenu({
    currency: "GBP",
    sources: [SOURCE, { url: "https://example.com/menu", type: "website" }, { url: "https://deliveroo.co.uk/menu/x", type: "deliveroo" }],
    items: [item({ section: "  Biryani ", description: "  On the   bone " }), item({ name: "Mango lassi", price: 3.95, currency: "INR", section: "" })],
  });
  assert.ok(out.ok);
  assert.deepEqual(out.value.items, [
    { position: 0, section: "Biryani", name: "Lamb biryani", description: "On the bone", price: 14.5, currency: "GBP" },
    { position: 1, section: null, name: "Mango lassi", description: null, price: 3.95, currency: "INR" },
  ]);
  // The repeated source collapses; positions stay dense.
  assert.deepEqual(out.value.sources, [
    { position: 0, url: "https://example.com/menu", type: "website" },
    { position: 1, url: "https://deliveroo.co.uk/menu/x", type: "deliveroo" },
  ]);
});

test("normalizeMenu refuses what isn't a menu, with a sentence that says why", () => {
  const cases: [Parameters<typeof normalizeMenu>[0], string][] = [
    [{ currency: "GBP", sources: [SOURCE], items: [] }, "empty_menu"],
    [{ currency: "GBP", sources: [SOURCE], items: Array.from({ length: MAX_MENU_ITEMS + 1 }, () => item()) }, "too_many_items"],
    [{ currency: "GBP", sources: [], items: [item()] }, "missing_source"],
    [{ currency: "GBP", sources: Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}`, type: "website" })), items: [item()] }, "too_many_sources"],
    [{ currency: "GBP", sources: [{ url: "http://example.com/menu", type: "website" }], items: [item()] }, "invalid_source_url"],
    [{ currency: "GBP", sources: [{ url: "https://user:pw@example.com/menu", type: "website" }], items: [item()] }, "invalid_source_url"],
    [{ currency: "GBP", sources: [{ url: "https://example.com/menu", type: "justeat" }], items: [item()] }, "invalid_source_type"],
    [{ currency: "gbp", sources: [SOURCE], items: [item()] }, "invalid_currency"],
    [{ sources: [SOURCE], items: [item()] }, "invalid_currency"],
    [{ currency: "GBP", sources: [SOURCE], items: [item({ currency: "XXQ" })] }, "invalid_currency"],
    [{ currency: "GBP", sources: [SOURCE], items: [item({ price: -1 })] }, "invalid_price"],
    [{ currency: "GBP", sources: [SOURCE], items: [item({ name: "  \u0000 " })] }, "invalid_item"],
  ];
  for (const [input, error] of cases) {
    const out = normalizeMenu(input);
    assert.equal(out.ok, false, error);
    assert.equal(!out.ok && out.error, error);
    assert.ok(!out.ok && out.message.length > 10);
  }
  // A free item is fine.
  assert.equal(normalizeMenu({ currency: "GBP", sources: [SOURCE], items: [item({ price: 0 })] }).ok, true);
});

test("sameMenu compares items and sources, in order", () => {
  const menu = (items: MenuItemInput[]) => {
    const out = normalizeMenu({ currency: "GBP", sources: [SOURCE], items });
    assert.ok(out.ok);
    return out.value;
  };
  assert.equal(sameMenu(menu([item(), item({ name: "Naan" })]), menu([item(), item({ name: "Naan" })])), true);
  assert.equal(sameMenu(menu([item(), item({ name: "Naan" })]), menu([item({ name: "Naan" }), item()])), false);
  assert.equal(sameMenu(menu([item()]), menu([item({ price: 15 })])), false);
});

test("items group by section in first-appearance order, sections matched without case", () => {
  const groups = groupMenuItems([
    { position: 2, section: "Grills", name: "c" },
    { position: 0, section: "Starters", name: "a" },
    { position: 1, section: null, name: "b" },
    { position: 3, section: "starters", name: "d" },
    { position: 4, section: null, name: "e" },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.section, group.items.map((entry) => entry.name)]),
    [
      ["Starters", ["a", "d"]],
      [null, ["b", "e"]],
      ["Grills", ["c"]],
    ],
  );
  assert.deepEqual(groupMenuItems([]), []);
});

test("previewMenu shows the first items and folds the rest, marking a split section", () => {
  const sections = [
    { section: "A", items: [1, 2, 3] },
    { section: "B", items: [4, 5, 6] },
    { section: "C", items: [7] },
  ];
  const { shown, rest } = previewMenu(sections, 4);
  assert.deepEqual(shown, [
    { section: "A", items: [1, 2, 3] },
    { section: "B", items: [4] },
  ]);
  assert.deepEqual(rest, [
    { section: "B", items: [5, 6], continued: true },
    { section: "C", items: [7], continued: false },
  ]);
  const short = previewMenu(sections);
  assert.equal(short.rest.length, 0);
  assert.equal(short.shown.flatMap((section) => section.items).length, 7);
});

test("prices format with the currency's own symbol and decimals", () => {
  assert.equal(formatMenuPrice(12.5, "GBP"), "£12.50");
  assert.equal(formatMenuPrice(250, "INR"), "₹250.00");
  assert.equal(formatMenuPrice(800, "JPY"), "¥800");
  // Dinars have three decimals; the symbol is whatever the locale data says.
  assert.match(formatMenuPrice(1.5, "KWD"), /1\.500$/);
  assert.equal(formatMenuPrice(3, "NOPE"), "NOPE 3");
});

test("a menu check needs flags exactly when flagged, and flags name a stored item or something else", () => {
  const items = [
    { position: 0, name: "Chicken shawarma wrap" },
    { position: 1, name: "Lager (bottle)" },
  ];
  const flagged = normalizeMenuCheck(
    {
      status: "flagged",
      sourceUrl: "https://example.com/menu",
      flags: [
        { item: "  lager (BOTTLE) ", reason: "alcohol" },
        { name: "Wine list", reason: "alcohol", note: "  On the back page " },
        { name: "Gelatine dessert", reason: "other" },
      ],
    },
    items,
  );
  assert.ok(flagged.ok);
  assert.deepEqual(flagged.value, {
    status: "flagged",
    sourceUrl: "https://example.com/menu",
    flags: [
      { position: 0, itemPosition: 1, itemName: "Lager (bottle)", reason: "alcohol", note: null },
      { position: 1, itemPosition: null, itemName: "Wine list", reason: "alcohol", note: "On the back page" },
      { position: 2, itemPosition: null, itemName: "Gelatine dessert", reason: "other", note: null },
    ],
  });
  const error = (input: Parameters<typeof normalizeMenuCheck>[0]) => {
    const out = normalizeMenuCheck(input, items);
    return out.ok ? "ok" : out.error;
  };
  assert.equal(error({ status: "clean" }), "ok");
  assert.equal(error({ status: "no_menu", flags: [] }), "ok");
  assert.equal(error({ status: "halal" }), "invalid_status");
  assert.equal(error({ status: "flagged" }), "missing_flags");
  assert.equal(error({ status: "clean", flags: [{ name: "Beer", reason: "alcohol" }] }), "unexpected_flags");
  assert.equal(error({ status: "flagged", flags: [{ item: "Pork ribs", reason: "pork" }] }), "unknown_item");
  assert.equal(error({ status: "flagged", flags: [{ item: "Lager (bottle)", name: "Beer", reason: "alcohol" }] }), "invalid_flag");
  assert.equal(error({ status: "flagged", flags: [{ reason: "alcohol" }] }), "invalid_flag");
  assert.equal(error({ status: "flagged", flags: [{ name: " ", reason: "alcohol" }] }), "invalid_flag");
  assert.equal(error({ status: "flagged", flags: [{ name: "Beer", reason: "gluten" }] }), "invalid_reason");
  assert.equal(error({ status: "flagged", flags: Array.from({ length: 51 }, () => ({ name: "Beer", reason: "alcohol" })) }), "too_many_flags");
  assert.equal(error({ status: "clean", sourceUrl: "http://example.com/menu" }), "invalid_source_url");
});

test("the menu check rule: only flagged alcohol and pork ask for claims; a clean check never does", () => {
  assert.deepEqual(menuCheckFacts("clean", []), []);
  assert.deepEqual(menuCheckFacts("no_menu", []), []);
  // Flags on a clean check (which validation refuses anyway) still never yield a claim.
  assert.deepEqual(menuCheckFacts("clean", [{ reason: "alcohol" }]), []);
  assert.deepEqual(menuCheckFacts("flagged", [{ reason: "other" }]), []);
  assert.deepEqual(menuCheckFacts("flagged", [{ reason: "alcohol" }, { reason: "alcohol" }]), ["alcohol"]);
  assert.deepEqual(menuCheckFacts("flagged", [{ reason: "pork" }, { reason: "other" }, { reason: "alcohol" }]), ["alcohol", "pork"]);
});

test("the badge shows for a clean check only, and says it isn't certification or a community check", () => {
  assert.equal(showsMenuBadge({ status: "clean" }), true);
  assert.equal(showsMenuBadge({ status: "flagged" }), false);
  assert.equal(showsMenuBadge({ status: "no_menu" }), false);
  assert.equal(showsMenuBadge(null), false);
  assert.equal(showsMenuBadge(undefined), false);
  assert.match(MENU_BADGE_LABEL, /no alcohol.*no pork/);
  assert.match(MENU_BADGE_TOOLTIP, /automated read/);
  assert.match(MENU_BADGE_TOOLTIP, /isn’t halal certification/);
  assert.match(MENU_BADGE_TOOLTIP, /isn’t a community check/);
});

test("read dates are ISO, not in the future and not before 2000; absent means now", () => {
  assert.deepEqual(parseCapturedAt(undefined, NOW), { ok: true, value: NOW });
  assert.deepEqual(parseCapturedAt(" ", NOW), { ok: true, value: NOW });
  assert.deepEqual(parseCapturedAt("2026-10-01", NOW), { ok: true, value: Date.parse("2026-10-01T00:00:00Z") });
  assert.deepEqual(parseCapturedAt("2026-10-01T08:30:00Z", NOW), { ok: true, value: Date.parse("2026-10-01T08:30:00Z") });
  // A few hours of clock skew is clamped to now.
  assert.deepEqual(parseCapturedAt("2026-10-18T18:00:00Z", NOW), { ok: true, value: NOW });
  for (const [value, message] of [
    ["yesterday", /ISO dates/],
    ["2026-13-45", /ISO dates/],
    ["2026-11-01", /future/],
    ["1999-12-31", /too far back/],
  ] as const) {
    const out = parseCapturedAt(value, NOW);
    assert.ok(!out.ok && message.test(out.message), value);
  }
});

test("logos are https URLs without credentials; anything else is dropped", () => {
  assert.equal(httpsLogoUrl("https://example.com/logo.png"), "https://example.com/logo.png");
  for (const bad of ["http://example.com/logo.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//example.com/logo.png", "https://u:p@example.com/l.png", "", null, 42])
    assert.equal(httpsLogoUrl(bad), null, String(bad));
});

test("stored values read back leniently", () => {
  assert.equal(parseMenuSourceType("zomato"), "zomato");
  assert.equal(parseMenuSourceType("justeat"), "other");
  assert.equal(parseMenuCheckStatus("flagged"), "flagged");
  assert.equal(parseMenuCheckStatus("halal"), null);
});
