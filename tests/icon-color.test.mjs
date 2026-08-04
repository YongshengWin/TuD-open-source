import assert from "node:assert/strict";
import test from "node:test";
import { iconBannerTheme, iconSurfaceTheme, monogramIconTheme, normalizedIconColor } from "../lib/icon-color.ts";

test("normalizes named, short, and full icon accent colors", () => {
  assert.equal(normalizedIconColor("blue"), "#2768ed");
  assert.equal(normalizedIconColor("#0af"), "#00aaff");
  assert.equal(normalizedIconColor("E50914"), "#e50914");
  assert.equal(normalizedIconColor("not-a-color"), "#2768ed");
});

test("builds a readable brand-derived detail banner palette", () => {
  const netflix = iconBannerTheme("e50914");
  const spotify = iconBannerTheme("1ed760");
  assert.equal(netflix.base, "#e50914");
  assert.equal(spotify.base, "#1ed760");
  assert.match(netflix.start, /^#[0-9a-f]{6}$/);
  assert.match(netflix.end, /^#[0-9a-f]{6}$/);
  assert.notEqual(netflix.start, spotify.start);
  assert.notEqual(netflix.end, spotify.end);
});

test("darkens very light monogram colors so white letters stay readable", () => {
  const white = monogramIconTheme("ffffff");
  const yellow = monogramIconTheme("ffff00");
  assert.equal(white.base, "#ffffff");
  assert.match(white.start, /^#[0-9a-f]{6}$/);
  assert.notEqual(white.start, white.base);
  assert.notEqual(yellow.start, "#ffff00");
});

test("surface themes stay pale while preserving the requested hue", () => {
  const blue = iconSurfaceTheme("#1677ff");
  const red = iconSurfaceTheme("#e50914");

  for (const theme of [blue, red]) {
    for (const value of Object.values(theme)) assert.match(value, /^#[0-9a-f]{6}$/);
  }
  assert.notEqual(blue.washPrimary, red.washPrimary);
  assert.equal(blue.base, "#1677ff");
  assert.equal(red.base, "#e50914");
});
