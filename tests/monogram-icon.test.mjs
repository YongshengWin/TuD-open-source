import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_MONOGRAM_GRAPHEMES,
  monogramAccent,
  monogramAccentFromIconId,
  monogramGraphemeCount,
  monogramIconId,
  monogramTextFromIconId,
  monogramUpstreamKey,
  monogramUpstreamKeyFromIconId,
  normalizeMonogramAccent,
  normalizeMonogramText,
} from "../lib/monogram-icon.ts";

test("normalizes monograms and limits them to five Unicode graphemes", () => {
  assert.equal(MAX_MONOGRAM_GRAPHEMES, 5);
  assert.equal(monogramGraphemeCount(" Ａ B 中 3 "), 4);
  assert.equal(normalizeMonogramText(" Ａ B 中 3 "), "AB中3");
  assert.equal(normalizeMonogramText("e\u0301中"), "é中");
  assert.equal(normalizeMonogramText("क्ष"), "क्ष");
  assert.equal(normalizeMonogramText("ABCDE"), "ABCDE");
  assert.throws(() => normalizeMonogramText("ABCDEF"), /最多 5 个字符/);
  assert.throws(() => normalizeMonogramText("AB✨"), /只能使用/);
  assert.throws(() => normalizeMonogramText("A-B"), /只能使用/);
  assert.throws(() => normalizeMonogramText("\u0301"), /只能使用/);
});

test("produces color-indexed ASCII identifiers and deterministic default accents", () => {
  const text = "图D3";
  const upstreamKey = monogramUpstreamKey(text);
  const iconId = monogramIconId(text);
  assert.match(upstreamKey, /^[A-Za-z0-9_-]+\.[0-9a-f]{6}$/);
  assert.equal(iconId, `monogram:${upstreamKey}`);
  assert.equal(monogramTextFromIconId(iconId), text);
  assert.equal(monogramAccentFromIconId(iconId), monogramAccent(text));
  assert.equal(monogramUpstreamKeyFromIconId(iconId), upstreamKey);
  assert.equal(monogramTextFromIconId(`${iconId}!`), null);
  assert.match(monogramAccent(text), /^[0-9a-f]{6}$/);
  assert.equal(monogramAccent(text), monogramAccent(" 图 D 3 "));
});

test("normalizes custom colors, indexes them uniquely, and parses legacy IDs", () => {
  const text = "BW";
  assert.equal(normalizeMonogramAccent("#12ABef", text), "12abef");
  assert.equal(normalizeMonogramAccent(" 12ABEF ", text), "12abef");
  assert.equal(normalizeMonogramAccent(undefined, text), monogramAccent(text));
  assert.throws(() => normalizeMonogramAccent("#abc", text), /颜色格式不正确/);
  assert.throws(() => normalizeMonogramAccent("red", text), /颜色格式不正确/);

  const blueId = monogramIconId(text, "#123456");
  const redId = monogramIconId(text, "ef4444");
  assert.notEqual(blueId, redId);
  assert.equal(monogramAccentFromIconId(blueId), "123456");
  assert.equal(monogramAccentFromIconId(redId), "ef4444");

  const encodedText = monogramUpstreamKey(text).split(".", 1)[0];
  const legacyId = `monogram:${encodedText}`;
  assert.equal(monogramTextFromIconId(legacyId), text);
  assert.equal(monogramAccentFromIconId(legacyId), monogramAccent(text));
  assert.equal(monogramUpstreamKeyFromIconId(legacyId), encodedText);
});

test("monogram writes are authenticated, indexed, and excluded from product search", async () => {
  const [route, database, catalog] = await Promise.all([
    readFile(new URL("../app/api/icons/monogram/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/icons.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/brand-catalog.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /auth\.api\.getSession/);
  assert.match(route, /status: 401/);
  assert.match(route, /createOrGetMonogramIcon/);
  assert.match(route, /body\.accent \?\? body\.color/);
  assert.match(database, /provider: MONOGRAM_PROVIDER/);
  assert.match(database, /accent: `#\$\{accent\}`/);
  assert.match(database, /insert\(iconCatalog\)/);
  assert.doesNotMatch(catalog.match(/const KNOWN_PROVIDERS = [^;]+;/s)?.[0] ?? "", /monogram/);
  assert.doesNotMatch(catalog.match(/const SEARCH_PROVIDERS = [^;]+;/s)?.[0] ?? "", /monogram/);
  assert.match(catalog, /record\.catalog\.provider === "monogram"/);
  assert.match(catalog, /normalizeMonogramAccent\(record\.catalog\.accent, text\)/);
});
