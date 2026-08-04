import assert from "node:assert/strict";
import test from "node:test";
import {
  IconAssetLoaderError,
  loadIconAsset,
  validateUntrustedSvgIcon,
} from "../lib/icon-asset-loader.server.ts";

const COMMIT = "a".repeat(40);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);

function descriptor(provider, assetUrl, mimeType, accent = null) {
  return { provider, assetUrl, mimeType, accent };
}

function expectLoaderError(code) {
  return (error) => error instanceof IconAssetLoaderError && error.code === code;
}

test("rejects local paths and providers that are served as static assets", async () => {
  let fetchCount = 0;
  const options = { fetcher: async () => {
    fetchCount += 1;
    return new Response(PNG);
  } };
  for (const assetUrl of [
    "/brands/../secret.png",
    "/brands/%2e%2e/secret.png",
    "public/brands/../../secret.png",
    "/brands//secret.png",
    "/tmp/secret.png",
    "file:///safe/public/brands/secret.png",
    "/brands/secret.png?version=1",
  ]) {
    await assert.rejects(
      loadIconAsset(descriptor("local", assetUrl, "image/png"), options),
      expectLoaderError("UNSAFE_REMOTE"),
      assetUrl,
    );
  }
  await assert.rejects(
    loadIconAsset(descriptor("simple-icons", "/brands/simple/16.27.0/example.svg", "image/svg+xml"), options),
    expectLoaderError("UNSAFE_REMOTE"),
  );
  assert.equal(fetchCount, 0);
});

test("allows only pinned GitHub Raw paths for each known remote provider", async () => {
  const cases = [
    {
      value: descriptor("hd-icons", `https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/border-radius/test.png`, "image/png"),
      body: PNG,
    },
    {
      value: descriptor("dashboard-icons", `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/${COMMIT}/svg/test.svg`, "image/svg+xml"),
      body: Buffer.from('<svg viewBox="0 0 20 20"><path fill="#000" d="M0 0h1v1z"/></svg>'),
    },
    {
      value: descriptor("lobe-icons", `https://raw.githubusercontent.com/lobehub/lobe-icons/${COMMIT}/packages/static-svg/icons/test.svg`, "image/svg+xml"),
      body: Buffer.from('<svg viewBox="0 0 20 20"><path d="M0 0h1v1z"/></svg>'),
    },
    {
      value: descriptor("selfhst-icons", `https://raw.githubusercontent.com/selfhst/icons/${COMMIT}/webp/test.webp`, "image/webp"),
      body: WEBP,
    },
  ];

  for (const entry of cases) {
    let fetchCount = 0;
    const result = await loadIconAsset(entry.value, {
      fetcher: async (input, init) => {
        fetchCount += 1;
        assert.equal(String(input), entry.value.assetUrl);
        assert.equal(init?.redirect, "manual");
        assert.ok(init?.signal instanceof AbortSignal);
        return new Response(entry.body, { status: 200 });
      },
    });
    assert.equal(fetchCount, 1);
    assert.equal(result.mimeType, entry.value.mimeType);
  }
});

test("rejects mutable refs, wrong hosts, repositories, directories, and provider mismatches", async () => {
  const invalid = [
    descriptor("hd-icons", `https://github.com/xushier/HD-Icons/${COMMIT}/border-radius/test.png`, "image/png"),
    descriptor("hd-icons", "https://raw.githubusercontent.com/xushier/HD-Icons/main/border-radius/test.png", "image/png"),
    descriptor("hd-icons", `https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/circle/test.png`, "image/png"),
    descriptor("hd-icons", `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/${COMMIT}/png/test.png`, "image/png"),
    descriptor("dashboard-icons", `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/${COMMIT}/icons/test.svg`, "image/svg+xml"),
    descriptor("lobe-icons", `https://raw.githubusercontent.com/lobehub/lobe-icons/${COMMIT}/packages/react/test.svg`, "image/svg+xml"),
    descriptor("lobe-icons", `https://raw.githubusercontent.com/lobehub/lobe-icons/${COMMIT}/packages/static-png/test.svg`, "image/svg+xml"),
    descriptor("selfhst-icons", `https://raw.githubusercontent.com/selfhst/icons/${COMMIT}/svg/test.png`, "image/png"),
    descriptor("selfhst-icons", `https://raw.githubusercontent.com/selfhst/icons/${COMMIT}/svg/test.svg?raw=1`, "image/svg+xml"),
    descriptor("simple-icons", `https://raw.githubusercontent.com/simple-icons/simple-icons/${COMMIT}/icons/test.svg`, "image/svg+xml"),
  ];
  let fetchCount = 0;
  for (const value of invalid) {
    await assert.rejects(
      loadIconAsset(value, {
        fetcher: async () => {
          fetchCount += 1;
          return new Response(PNG);
        },
      }),
      expectLoaderError("UNSAFE_REMOTE"),
      value.assetUrl,
    );
  }
  assert.equal(fetchCount, 0);
});

test("never follows remote redirects", async () => {
  const value = descriptor(
    "hd-icons",
    `https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/border-radius/test.png`,
    "image/png",
  );
  await assert.rejects(
    loadIconAsset(value, {
      fetcher: async () => new Response(null, {
        status: 302,
        headers: { location: "https://example.com/icon.png" },
      }),
    }),
    expectLoaderError("REDIRECT"),
  );
});

test("enforces timeouts and the hard 2 MiB ceiling", async () => {
  const remote = descriptor(
    "hd-icons",
    `https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/border-radius/test.png`,
    "image/png",
  );
  await assert.rejects(
    loadIconAsset(remote, {
      timeoutMs: 10,
      fetcher: async () => new Promise(() => {}),
    }),
    expectLoaderError("TIMEOUT"),
  );
  await assert.rejects(
    loadIconAsset(remote, {
      maxBytes: 8,
      fetcher: async () => new Response(PNG, { headers: { "content-length": String(PNG.length) } }),
    }),
    expectLoaderError("TOO_LARGE"),
  );
});

test("validates raster magic bytes rather than trusting MIME declarations", async () => {
  const cases = [
    [`https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/border-radius/a.png`, "image/png", PNG, "hd-icons"],
    [`https://raw.githubusercontent.com/homarr-labs/dashboard-icons/${COMMIT}/webp/a.webp`, "image/webp", WEBP, "dashboard-icons"],
  ];
  for (const [assetUrl, mimeType, bytes, provider] of cases) {
    const result = await loadIconAsset(descriptor(provider, assetUrl, mimeType), {
      fetcher: async () => new Response(bytes),
    });
    assert.ok(result.bytes.equals(bytes));
  }

  await assert.rejects(
    loadIconAsset(descriptor("hd-icons", `https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/border-radius/fake.png`, "image/png"), {
      fetcher: async () => new Response(Buffer.from("not a png")),
    }),
    expectLoaderError("MIME_MISMATCH"),
  );
  await assert.rejects(
    loadIconAsset(descriptor("hd-icons", `https://raw.githubusercontent.com/xushier/HD-Icons/${COMMIT}/border-radius/wrong.png`, "image/png"), {
      fetcher: async () => new Response(JPEG),
    }),
    expectLoaderError("MIME_MISMATCH"),
  );
});

test("rejects executable, external, animated, and embedded SVG content", async () => {
  const unsafe = [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"><path/></svg>',
    '<svg><foreignObject><div>unsafe</div></foreignObject></svg>',
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg><use href="javascript:alert(1)"/></svg>',
    '<svg><path style="fill:url(https://example.com/a.svg)"/></svg>',
    '<svg><style>@import "https://example.com/a.css";</style><path/></svg>',
    '<svg><style>.a{fill:u\\72l(https://example.com/a.svg)}</style><path class="a"/></svg>',
    '<svg><animate attributeName="x"/></svg>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg/>',
  ];
  for (const svg of unsafe) {
    await assert.rejects(
      loadIconAsset(descriptor("dashboard-icons", `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/${COMMIT}/svg/unsafe.svg`, "image/svg+xml"), {
        fetcher: async () => new Response(Buffer.from(svg)),
      }),
      expectLoaderError("UNSAFE_SVG"),
      svg,
    );
  }
});

test("validates standalone untrusted SVG bytes for server-side canonical caching", () => {
  const safe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="#123" d="M0 0h1v1z"/></svg>');
  const result = validateUntrustedSvgIcon(safe);
  assert.equal(result.mimeType, "image/svg+xml");
  assert.deepEqual(result.bytes, safe);

  assert.throws(
    () => validateUntrustedSvgIcon(Buffer.from('<svg><image href="https://attacker.example/pixel"/></svg>')),
    expectLoaderError("UNSAFE_SVG"),
  );

  const embeddedPng = `<svg xmlns="http://www.w3.org/2000/svg"><image id="logo" xlink:href="data:image/png;base64,${PNG.toString("base64")}"/></svg>`;
  assert.equal(
    validateUntrustedSvgIcon(Buffer.from(embeddedPng), { allowEmbeddedPngImages: true }).mimeType,
    "image/svg+xml",
  );
  for (const unsafeImage of [
    '<svg><image href="https://attacker.example/pixel.png"/></svg>',
    '<svg><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
  ]) {
    assert.throws(
      () => validateUntrustedSvgIcon(Buffer.from(unsafeImage), { allowEmbeddedPngImages: true }),
      expectLoaderError("UNSAFE_SVG"),
    );
  }
});

test("preserves upstream multicolor and monochrome SVG artwork", async () => {
  const monochrome = '<svg viewBox="0 0 24 24"><path fill="#000" d="M0 0h1v1z"/></svg>';
  const multicolor = '<svg viewBox="0 0 24 24"><path fill="#f00"/><path fill="#00f"/></svg>';
  for (const svg of [monochrome, multicolor]) {
    const dashboard = await loadIconAsset(
      descriptor(
        "dashboard-icons",
        `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/${COMMIT}/svg/test.svg`,
        "image/svg+xml",
        "#00ff00",
      ),
      { fetcher: async () => new Response(Buffer.from(svg)) },
    );
    assert.equal(dashboard.bytes.toString(), svg);
  }
});
