import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  catalogDomainMatchCandidates,
  catalogDomainMatchesWebsite,
} from "../lib/icon-domain-match.ts";
import generatedCatalog from "../lib/generated/icon-catalog.json" with { type: "json" };
import domainOverrides from "../lib/icon-catalog-domain-overrides.json" with { type: "json" };

test("catalog domain matching follows DNS label boundaries and excludes public suffixes", () => {
  assert.deepEqual(catalogDomainMatchCandidates("home.console.aliyun.com"), [
    "home.console.aliyun.com",
    "console.aliyun.com",
    "aliyun.com",
  ]);
  assert.equal(catalogDomainMatchesWebsite("www.aliyun.com", "aliyun.com"), true);
  assert.equal(catalogDomainMatchesWebsite("home.console.aliyun.com", "aliyun.com"), true);
  assert.equal(catalogDomainMatchesWebsite("notaliyun.com", "aliyun.com"), false);
  assert.equal(catalogDomainMatchesWebsite("aliyun.com.attacker.example", "aliyun.com"), false);

  assert.deepEqual(catalogDomainMatchCandidates("service.example.co.uk"), [
    "service.example.co.uk",
    "example.co.uk",
  ]);
  assert.deepEqual(catalogDomainMatchCandidates("tenant.github.io"), ["tenant.github.io"]);
  assert.equal(catalogDomainMatchesWebsite("tenant.github.io", "github.io"), false);
});

test("generated icon catalog carries the curated Aliyun, Alibaba Cloud, and Spaceship domains", () => {
  const expected = {
    "dashboard-icons:aliyun": "aliyun.com",
    "simple-icons:alibabacloud": "alibabacloud.com",
    "simple-icons:spaceship": "spaceship.com",
  };
  assert.deepEqual(domainOverrides, expected);

  const domainsById = new Map(generatedCatalog.entries.map((entry) => [entry.id, entry.domain]));
  for (const [id, domain] of Object.entries(expected)) {
    assert.equal(domainsById.get(id), domain, id);
  }
  const aliyun = generatedCatalog.entries.find((entry) => entry.id === "dashboard-icons:aliyun");
  assert.ok(aliyun?.aliases.includes("阿里云"));
});

test("catalog lookup runs before cached website rows, quota, and remote discovery", async () => {
  const service = await readFile(new URL("../lib/icon-discovery-service.server.ts", import.meta.url), "utf8");
  const catalogLookup = service.indexOf("findBrandByWebsite(requestedDomain)");
  const websiteCacheLookup = service.indexOf("getIconById(`website:${requestedDomain}`)");
  const quota = service.indexOf("assertDiscoveryRate(userId)");
  const remoteDiscovery = service.indexOf("discoverOfficialDomainIcon(website)");

  assert.ok(catalogLookup >= 0);
  assert.ok(catalogLookup < websiteCacheLookup);
  assert.ok(catalogLookup < quota);
  assert.ok(catalogLookup < remoteDiscovery);
  assert.ok(websiteCacheLookup < quota);
  assert.ok(websiteCacheLookup < remoteDiscovery);
});
