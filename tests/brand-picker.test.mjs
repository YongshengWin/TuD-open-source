import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { websiteBrandChoiceFromResponse } from "../lib/brand-options.ts";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("icon picker unifies catalog and website search while offering a server-indexed monogram fallback", async () => {
  const [picker, options, catalog] = await Promise.all([
    source("../app/components/BrandPicker.tsx"),
    source("../lib/brand-options.ts"),
    source("../lib/brand-catalog.server.ts"),
  ]);

  assert.equal((picker.match(/placeholder="搜索图标或输入官网/g) ?? []).length, 1, "catalog and website discovery must share one search field");
  assert.match(picker, /function websiteFromQuery/);
  assert.match(picker, /fetch\(`\/api\/brands\/search\?q=/);
  assert.match(picker, /fetch\("\/api\/icons\/discover"/);
  const discovery = picker.slice(picker.indexOf("async function discoverWebsiteIcon"), picker.indexOf("async function confirmMonogram"));
  assert.match(discovery, /readApiJsonObject\(response/);
  assert.doesNotMatch(discovery, /response\.json\(\)/, "website discovery must tolerate non-JSON error responses");
  assert.doesNotMatch(discovery, /onWebsiteChange\(/, "discovery must stay a draft until explicit confirmation");
  assert.match(picker, /if \(candidateWebsite\) onWebsiteChange\(candidateWebsite\)/);
  assert.match(picker, /placeholder="搜索图标或输入官网/);
  assert.match(picker, /placeholder="输入 1–5 个字符/);
  assert.match(picker, /fetch\("\/api\/icons\/monogram"/);
  assert.match(picker, /MAX_MONOGRAM_GRAPHEMES/);
  assert.match(picker, /function limitMonogramDraft/);
  assert.match(picker, /type="color"/);
  assert.match(picker, /JSON\.stringify\(\{ text: monogram\.choice\.title, accent: monogramColor \}\)/);
  assert.match(picker, /aria-label="字母图标颜色"/);
  assert.match(picker, /aria-label="字母图标文字，最多 5 个字符"/);
  assert.match(picker, /onCompositionStart/);
  assert.match(picker, /creatingMonogramRef/);
  assert.match(picker, /role="alert"/);
  assert.doesNotMatch(picker, /role="listbox"/);
  assert.match(picker, /创建字母图标/);
  assert.match(options, /monogram: "字母图标"/);
  assert.doesNotMatch(picker, /brand-website-discovery/);
  assert.doesNotMatch(`${picker}\n${options}`, /品牌/);
  assert.match(catalog, /providers: query \? SEARCH_PROVIDERS : KNOWN_PROVIDERS/);
});

test("all bundled payment artwork is rendered instead of the fallback icon", async () => {
  const icon = await source("../app/components/BrandIcon.tsx");

  for (const key of ["applepay", "googlepay", "mastercard", "visa"]) {
    assert.match(icon, new RegExp(`"${key}"`), `${key} must be a recognized local icon`);
    assert.match(icon, new RegExp(`fullColorIcons[\\s\\S]*"${key}"`), `${key} must preserve its original colors`);
  }
});

test("website discovery responses always produce a renderable legacy icon key", () => {
  const choice = websiteBrandChoiceFromResponse({
    iconId: "website:greencloudvps.com",
    title: "GreenCloud - Affordable KVM and Windows VPS",
    accent: "blue",
    source: "website",
    domain: "greencloudvps.com",
  }, "greencloudvps.com");

  assert.equal(choice.iconKey, "fallback");
  assert.equal(choice.iconId, "website:greencloudvps.com");
  assert.equal(choice.source, "website");
  assert.equal(choice.domain, "greencloudvps.com");
  assert.throws(
    () => websiteBrandChoiceFromResponse({ title: "Missing ID" }, "greencloudvps.com"),
    /没有写入服务端索引/,
  );

  const catalogChoice = websiteBrandChoiceFromResponse({
    iconId: "simple-icons:spaceship",
    iconKey: "simple-spaceship",
    title: "Spaceship",
    accent: "394eff",
    source: "simple-icons",
    domain: "spaceship.com",
  }, "spaceship.com");
  assert.equal(catalogChoice.iconKey, "simple-spaceship");
  assert.equal(catalogChoice.source, "simple-icons");
  assert.equal(catalogChoice.sourceLabel, "Simple Icons");
});
