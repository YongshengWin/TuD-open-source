import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("uses one persisted accent for card and detail identity surfaces", async () => {
  const [dashboard, css] = await Promise.all([
    source("../app/components/Dashboard.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(dashboard, /item\.cardAccent \? `#\$\{item\.cardAccent\}` : item\.accent/);
  assert.match(dashboard, /<article className=\{`renewal-tile[^>]+style=\{subscriptionSurfaceStyle\(surface\.accent\)\}/s);
  assert.match(dashboard, /className="detail-head" style=\{surfaceStyle\}/);
  assert.match(dashboard, /onColorResolved=\{surface\.onColorResolved\}/);
  assert.match(dashboard, /useResolvedSubscriptionAccent/);
  assert.match(dashboard, /cardAccent:\s*cardAccent \|\| null/);
  assert.match(dashboard, /type="color"/);
  assert.match(dashboard, /aria-pressed=\{!cardAccent\}/);

  assert.match(css, /\.renewal-tile\s*\{[^}]*var\(--surface-primary/s);
  assert.match(css, /\.detail-head\s*\{[^}]*var\(--surface-primary/s);
  assert.doesNotMatch(css, /\.detail-title-wrap span\s*\{/, "detail metadata color must not recolor the nested BrandIcon glyph");
  assert.doesNotMatch(css, /\.brand-current span\s*\{/, "picker metadata color must not recolor the nested BrandIcon glyph");
  assert.match(css, /\.detail-amount\s*\{[^}]*background:\s*var\(--paper\)/s);
  assert.doesNotMatch(css, /\.detail-amount\s*\{[^}]*--detail-accent/s);
});

test("ticket converts the complete monthly total and allows a display currency", async () => {
  const [dashboard, ticket] = await Promise.all([
    source("../app/components/Dashboard.tsx"),
    source("../app/components/SubscriptionTicket.tsx"),
  ]);

  assert.match(dashboard, /initialSummaryCurrency=\{summaryCurrency\}/);
  assert.match(dashboard, /initialExchangeRates=\{exchangeRates\}/);
  assert.match(ticket, /totalMonthlySpendInCurrency\(monthly, summaryCurrency, exchangeRates\)/);
  assert.match(ticket, /aria-label="订阅票汇总币种"/);
  assert.match(ticket, /预计每月支出 · \{summaryCurrency\}/);
  assert.doesNotMatch(ticket, /const primary = monthly\[0\]/);
});
