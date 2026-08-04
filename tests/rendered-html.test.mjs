import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("build emits a standard self-hosted Next.js app", async () => {
  await access(new URL("../.next/BUILD_ID", import.meta.url));
  await access(new URL("../.next/server/app/page.js", import.meta.url));
});

test("uses independent auth and server-backed data", async () => {
  const [dashboard, css, schema, auth, packageJson, readme] = await Promise.all([
    readSource("../app/components/Dashboard.tsx"),
    readSource("../app/globals.css"),
    readSource("../db/schema.ts"),
    readSource("../lib/auth.ts"),
    readSource("../package.json"),
    readSource("../README.md"),
  ]);

  assert.match(dashboard, /fetch\("\/api\/subscriptions"/);
  assert.match(dashboard, /管理分类/);
  assert.match(dashboard, /formatSubscriptionDate\(item\.dueDate\)/);
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB/i);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(schema, /idx_subscriptions_user_due/);
  assert.match(schema, /dueDate: text\("due_date"\)/);
  assert.match(schema, /export const passkey/);
  assert.match(auth, /emailAndPassword/);
  assert.match(auth, /passkey\(/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
  assert.match(readme, /不依赖 ChatGPT 登录/);
  await access(new URL("../public/brands/spotify.svg", import.meta.url));
});

test("centers subscription details and keeps renewal out of cards", async () => {
  const [dashboard, css] = await Promise.all([
    readSource("../app/components/Dashboard.tsx"),
    readSource("../app/globals.css"),
  ]);
  const tile = functionSource(dashboard, "SubscriptionTile", "AddSubscriptionModal");
  const details = functionSource(dashboard, "SubscriptionDetailModal", "SubscriptionForm");

  assert.match(dashboard, /<SubscriptionDetailModal/);
  assert.match(details, /className=\{`modal detail-modal/);
  assert.match(css, /\.modal-backdrop\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center/s);
  assert.match(css, /\.detail-modal\s*\{[^}]*width:\s*min\(620px, 100%\)/s);
  assert.doesNotMatch(css, /\.detail-drawer|drawer-in/);

  assert.doesNotMatch(tile, /tile-renew|onRenew|标记已续费/);
  assert.match(details, /isAutoRenewableCycle\(item\.billingCycle\)/);
  assert.match(details, /className="renew-detail-button"/);
  assert.match(details, /method:\s*"PATCH"/);
  assert.match(details, /标记已续费/);
  assert.equal((dashboard.match(/标记已续费/g) ?? []).length, 1, "renewal action should appear only in details");
});

test("supports a searchable brand picker with explicit confirmation", async () => {
  const [dashboard, brandPicker, brandRoute] = await Promise.all([
    readSource("../app/components/Dashboard.tsx"),
    readSource("../app/components/BrandPicker.tsx"),
    readSource("../app/api/brands/search/route.ts"),
  ]);

  assert.match(dashboard, /<BrandPicker value=\{icon\} onChange=\{setIcon\}/);
  assert.doesNotMatch(dashboard, /icon-rail|支持横向滑动/);
  assert.match(brandPicker, /fetch\(`\/api\/brands\/search\?q=/);
  assert.match(brandPicker, /const \[candidate, setCandidate\]/);
  assert.match(brandPicker, /onClick=\{\(\) => \{\s*setCandidate\(option\);/);
  assert.doesNotMatch(brandPicker, /onChange\(option\)/);
  assert.match(brandPicker, /onChange\(candidate\)/);
  assert.match(brandPicker, /onChange\(body\.icon\)/);
  assert.match(brandPicker, /使用此图标/);
  assert.equal((brandPicker.match(/onChange\(/g) ?? []).length, 2, "catalog and monogram choices must commit only from their confirmation actions");
  assert.doesNotMatch(brandPicker, /role="listbox"/);
  assert.match(brandPicker, /aria-pressed=/);
  assert.match(brandPicker, /aria-live="polite"/);
  assert.equal((dashboard.match(/aria-pressed=\{viewMode ===/g) ?? []).length, 3, "all view switches expose their selected state");
  assert.match(brandRoute, /searchBrands\(query, limit\)/);
  assert.match(brandRoute, /Cache-Control/);
});

test("shows an optional account and persists direct category ordering", async () => {
  const [dashboard, schema, subscriptions, orderRoute, categories, categoryRoute, brandCatalog] = await Promise.all([
    readSource("../app/components/Dashboard.tsx"),
    readSource("../db/schema.ts"),
    readSource("../db/subscriptions.ts"),
    readSource("../app/api/subscriptions/order/route.ts"),
    readSource("../db/categories.ts"),
    readSource("../app/api/categories/route.ts"),
    readSource("../lib/brand-catalog.server.ts"),
  ]);
  const details = functionSource(dashboard, "SubscriptionDetailModal", "SubscriptionForm");
  const form = functionSource(dashboard, "SubscriptionForm", "CategoryManagerModal");
  const categoryManager = dashboard.slice(dashboard.indexOf("function CategoryManagerModal"));

  assert.match(schema, /accountName:\s*text\("account_name"\)/);
  assert.match(subscriptions, /accountName:\s*normalizeAccountName\(input\.accountName\)/);
  assert.match(form, /name="accountName"/);
  assert.match(form, /accountName:\s*form\.get\("accountName"\)/);
  assert.match(details, /<dt>账号<\/dt>/);

  assert.doesNotMatch(dashboard, /\bArrowDownUp\b|\bSortMode\b|\bsortMode\b|nextSortMode|sortLabels/);
  assert.doesNotMatch(dashboard, /SubscriptionOrderModal|订阅显示顺序|调整订阅顺序/);
  assert.match(categoryManager, /fetch\("\/api\/categories"/);
  assert.match(categoryManager, /method:\s*"PATCH"/);
  assert.match(categoryManager, /names:\s*next\.map\(\(group\) => group\.name\)/);
  assert.match(categoryManager, /draggable=\{!savingOrder/);
  assert.match(categoryManager, /aria-label=\{`拖动分类 /);
  assert.match(categoryManager, /aria-label=\{`上移分类 /);
  assert.match(categoryManager, /aria-label=\{`下移分类 /);
  assert.match(categoryManager, /移动后自动保存/);
  assert.match(categoryManager, /aria-live="polite"/);
  assert.match(schema, /sortPosition:\s*integer\("sort_position"\).*subscription_categories/s);
  assert.match(schema, /idx_subscription_categories_user_sort/);
  assert.match(categories, /reorderCategories/);
  assert.match(categories, /orderBy\(asc\(subscriptionCategories\.sortPosition\)/);
  assert.match(categoryRoute, /reorderCategories\(userId, names\)/);
  assert.match(schema, /sortPosition:\s*integer\("sort_position"\)/);
  assert.match(schema, /idx_subscriptions_user_sort/);
  assert.match(subscriptions, /orderBy\(asc\(subscriptions\.sortPosition\)/);
  assert.match(orderRoute, /reorderSubscriptions\(userId, body\.ids\)/);
  assert.match(subscriptions, /pg_advisory_xact_lock/, "create and reorder should share a per-user lock");
  assert.match(subscriptions, /MAX_ORDERED_SUBSCRIPTIONS/, "creation and reorder must share the same limit");
  assert.match(orderRoute, /SubscriptionOrderValidationError/);
  assert.match(orderRoute, /status:\s*500/);
  assert.match(schema, /iconKey:\s*text\("icon_key"\)\.notNull\(\)\.default\("fallback"\)/);
  assert.match(brandCatalog, /iconKey === "fallback" \|\| iconKey === "sparkles"/);
});

test("generated brand catalogs are broad, unique, and wired to the server index", async () => {
  const [simpleCatalog, iconCatalog, brandIcon, brandSearch, packageJson, nextConfig] = await Promise.all([
    readSource("../lib/generated/brand-catalog.json").then(JSON.parse),
    readSource("../lib/generated/icon-catalog.json").then(JSON.parse),
    readSource("../app/components/BrandIcon.tsx"),
    readSource("../lib/brand-catalog.server.ts"),
    readSource("../package.json"),
    readSource("../next.config.ts"),
  ]);

  assert.equal(typeof simpleCatalog.version, "string");
  assert.ok(Array.isArray(simpleCatalog.icons));
  assert.ok(simpleCatalog.icons.length >= 3_000, `expected a broad Simple Icons catalog, got ${simpleCatalog.icons.length}`);

  const slugs = new Set();
  for (const icon of simpleCatalog.icons) {
    assert.equal(typeof icon.title, "string");
    assert.match(icon.slug, /^[a-z0-9_]{1,80}$/);
    assert.match(icon.hex, /^[0-9a-f]{6}$/i);
    if (icon.aliases !== undefined) {
      assert.ok(Array.isArray(icon.aliases));
      assert.ok(icon.aliases.every((alias) => typeof alias === "string" && alias.length > 0));
    }
    assert.equal(slugs.has(icon.slug), false, `duplicate brand slug: ${icon.slug}`);
    slugs.add(icon.slug);
  }

  for (const slug of ["netflix", "wechat", "github", "uniqlo_ja"]) {
    assert.equal(slugs.has(slug), true, `missing searchable brand: ${slug}`);
    await access(new URL(`../public/brands/simple/${simpleCatalog.version}/${slug}.svg`, import.meta.url));
  }

  assert.equal(iconCatalog.version, 1);
  assert.match(iconCatalog.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Array.isArray(iconCatalog.entries));
  assert.ok(iconCatalog.entries.length >= 10_000, `expected a unified catalog, got ${iconCatalog.entries.length}`);

  const ids = new Set();
  const providers = new Set();
  for (const entry of iconCatalog.entries) {
    assert.equal(entry.id, `${entry.provider}:${entry.upstreamKey}`);
    assert.equal(ids.has(entry.id), false, `duplicate icon id: ${entry.id}`);
    assert.equal(typeof entry.title, "string");
    assert.ok(entry.title.length > 0);
    assert.ok(Array.isArray(entry.aliases));
    assert.ok(entry.aliases.every((alias) => typeof alias === "string" && alias.length > 0));
    assert.equal(Number.isInteger(entry.priority), true);
    assert.equal(typeof entry.assetUrl, "string");
    ids.add(entry.id);
    providers.add(entry.provider);
  }
  for (const provider of ["local", "hd-icons", "dashboard-icons", "lobe-icons", "selfhst-icons", "simple-icons"]) {
    assert.equal(providers.has(provider), true, `missing icon provider: ${provider}`);
  }

  assert.match(brandIcon, /\^\[a-z0-9_\]/, "all generated slugs must be renderable");
  assert.match(brandIcon, /needsDarkSurface/, "near-white brand artwork needs a contrasting surface");
  assert.match(brandIcon, /SIMPLE_ICONS_VERSION/, "asset URLs must be versioned");
  for (const alias of ["微信", "知乎", "哔哩哔哩", "抖音", "支付宝", "淘宝", "微博"]) {
    assert.equal(
      iconCatalog.entries.some((entry) => entry.aliases.includes(alias)),
      true,
      `missing generated search alias: ${alias}`,
    );
  }
  assert.match(brandSearch, /generatedCatalog/);
  assert.match(brandSearch, /ensureIconCatalogSeed/);
  assert.match(packageJson, /"predev":\s*"npm run brands:generate"/);
  assert.match(packageJson, /"prebuild":\s*"npm run brands:generate"/);
  assert.match(nextConfig, /max-age=31536000, immutable/);
});
