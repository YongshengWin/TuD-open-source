import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("deletes a user-owned subscription only after explicit confirmation", async () => {
  const [dashboard, route, database, css] = await Promise.all([
    source("../app/components/Dashboard.tsx"),
    source("../app/api/subscriptions/[id]/route.ts"),
    source("../db/subscriptions.ts"),
    source("../app/globals.css"),
  ]);

  assert.match(dashboard, /删除后无法恢复，相关的提醒记录也会一并移除/);
  assert.match(dashboard, /fetch\(`\/api\/subscriptions\/\$\{encodeURIComponent\(item\.id\)\}`/);
  assert.match(dashboard, /method:\s*"DELETE"/);
  assert.match(dashboard, /JSON\.stringify\(\{ confirm: item\.id \}\)/);
  assert.match(dashboard, /items\.filter\(\(item\) => item\.id !== id\)/);
  assert.match(dashboard, /deleteCancelRef\.current\?\.focus\(\)/);
  assert.match(dashboard, /if \(!deleting\) onClose\(\)/);
  assert.match(dashboard, /aria-label="关闭" disabled=\{deleting\}/);

  assert.match(route, /body\?\.confirm !== id/);
  assert.match(route, /permanentlyDeleteSubscription\(currentSession\.user\.id, id\)/);
  assert.match(database, /eq\(subscriptions\.userId, userId\)/);
  assert.match(database, /eq\(subscriptions\.id, id\)/);
  assert.match(css, /\.detail-delete-confirm/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.detail-delete-actions/);
});
