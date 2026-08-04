import assert from "node:assert/strict";
import test from "node:test";
import {
  WebsiteIconDiscoveryError,
  detectWebsiteIconMimeType,
  discoverOfficialDomainIcon,
  discoverWebsiteIcon,
  isPublicWebsiteAddress,
} from "../lib/website-icon-discovery.server.ts";

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

function response(status, body = "", headers = {}) {
  return {
    status,
    headers,
    body: Buffer.isBuffer(body) ? body : Buffer.from(body),
  };
}

function expectDiscoveryError(code) {
  return (error) => error instanceof WebsiteIconDiscoveryError && error.code === code;
}

test("rejects credentials, unsafe ports, and non-public IP ranges before requesting", async () => {
  let requestCount = 0;
  const requester = async () => {
    requestCount += 1;
    return response(200, "");
  };

  await assert.rejects(
    discoverWebsiteIcon("https://user:secret@example.com", { requester }),
    expectDiscoveryError("UNSAFE_URL"),
  );
  await assert.rejects(
    discoverWebsiteIcon("https://example.com:8443", { requester }),
    expectDiscoveryError("UNSAFE_URL"),
  );
  await assert.rejects(
    discoverWebsiteIcon("file:///etc/passwd", { requester }),
    expectDiscoveryError("INVALID_URL"),
  );
  await assert.rejects(
    discoverWebsiteIcon("http://127.0.0.1", { requester }),
    expectDiscoveryError("UNSAFE_URL"),
  );
  await assert.rejects(
    discoverWebsiteIcon("http://[::1]", { requester }),
    expectDiscoveryError("UNSAFE_URL"),
  );

  assert.equal(requestCount, 0);
});

test("accepts a bare domain and defaults it to HTTPS", async () => {
  const requests = [];
  const result = await discoverWebsiteIcon("example.com", {
    resolver: async () => [PUBLIC_ADDRESS],
    requester: async (request) => {
      requests.push(request.url.toString());
      if (request.url.pathname === "/") return response(200, '<title>Bare domain</title><link rel="icon" href="/icon.png">');
      return response(200, PNG);
    },
  });

  assert.deepEqual(requests, ["https://example.com/", "https://example.com/icon.png"]);
  assert.equal(result.website, "https://example.com/");
});

test("rejects private, link-local, reserved, multicast, and mixed DNS answers", async () => {
  const blocked = [
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "192.0.2.1",
    "224.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "ff02::1",
  ];
  for (const address of blocked) assert.equal(isPublicWebsiteAddress(address), false, address);
  assert.equal(isPublicWebsiteAddress("1.1.1.1"), true);
  assert.equal(isPublicWebsiteAddress("2606:4700:4700::1111"), true);

  let requested = false;
  await assert.rejects(
    discoverWebsiteIcon("https://mixed.example", {
      resolver: async () => [PUBLIC_ADDRESS, { address: "10.0.0.2", family: 4 }],
      requester: async () => {
        requested = true;
        return response(200, "");
      },
    }),
    expectDiscoveryError("UNSAFE_URL"),
  );
  assert.equal(requested, false);
});

test("pins requests to the validated address and revalidates every redirect", async () => {
  const requests = [];
  await assert.rejects(
    discoverWebsiteIcon("https://example.com/start", {
      resolver: async () => [PUBLIC_ADDRESS],
      requester: async (request) => {
        requests.push({ url: request.url.toString(), address: request.address, family: request.family });
        return response(302, "", { location: "http://169.254.169.254/latest/meta-data" });
      },
    }),
    expectDiscoveryError("UNSAFE_URL"),
  );

  assert.deepEqual(requests, [{
    url: "https://example.com/start",
    address: PUBLIC_ADDRESS.address,
    family: 4,
  }]);
});

test("stops after at most three redirects", async () => {
  let count = 0;
  await assert.rejects(
    discoverWebsiteIcon("https://example.com/0", {
      resolver: async () => [PUBLIC_ADDRESS],
      requester: async (request) => {
        count += 1;
        const current = Number(request.url.pathname.slice(1));
        return response(302, "", { location: `/${current + 1}` });
      },
    }),
    expectDiscoveryError("TOO_MANY_REDIRECTS"),
  );
  assert.equal(count, 4);
});

test("enforces response size limits even for an injected requester", async () => {
  await assert.rejects(
    discoverWebsiteIcon("https://example.com", {
      resolver: async () => [PUBLIC_ADDRESS],
      requester: async (request) => {
        assert.equal(request.maxBytes, 10);
        return response(200, "12345678901");
      },
      htmlMaxBytes: 10,
    }),
    expectDiscoveryError("TOO_LARGE"),
  );
});

test("prefers the largest apple touch icon, then manifest and ordinary icons", async () => {
  const imageRequests = [];
  const html = `<!doctype html>
    <html><head>
      <title> Example &amp; Co </title>
      <link rel="icon" href="/tiny.png" sizes="32x32">
      <link rel="apple-touch-icon" href="/apple-120.png" sizes="120x120">
      <link rel="manifest" href="/site.webmanifest">
      <link rel="apple-touch-icon" href="/apple-180.png" sizes="180x180">
    </head></html>`;

  const result = await discoverWebsiteIcon("https://example.com/account#section", {
    resolver: async () => [PUBLIC_ADDRESS],
    requester: async (request) => {
      assert.equal(request.address, PUBLIC_ADDRESS.address);
      if (request.url.pathname === "/account") return response(200, html, { "content-type": "text/html" });
      if (request.url.pathname === "/site.webmanifest") {
        return response(200, JSON.stringify({
          icons: [{ src: "/manifest-512.png", sizes: "512x512", type: "image/png", purpose: "any" }],
        }), { "content-type": "application/manifest+json" });
      }
      imageRequests.push(request.url.pathname);
      if (request.url.pathname === "/apple-180.png") return response(200, PNG, { "content-type": "text/plain" });
      return response(404);
    },
  });

  assert.deepEqual(imageRequests, ["/apple-180.png"]);
  assert.equal(result.website, "https://example.com/");
  assert.equal(result.domain, "example.com");
  assert.equal(result.sourceUrl, "https://example.com/apple-180.png");
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.title, "Example & Co");
  assert.deepEqual(result.bytes, PNG);
});

test("accepts a declared SVG icon only after strict SVG validation", async () => {
  const imageRequests = [];
  const result = await discoverWebsiteIcon("https://example.com", {
    resolver: async () => [PUBLIC_ADDRESS],
    requester: async (request) => {
      if (request.url.pathname === "/") return response(200, '<title>SVG</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      imageRequests.push(request.url.pathname);
      if (request.url.pathname === "/favicon.svg") return response(200, '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#078dee" d="M0 0h10v10H0z"/></svg>');
      return response(404);
    },
  });

  assert.deepEqual(imageRequests, ["/favicon.svg"]);
  assert.equal(result.mimeType, "image/svg+xml");
  assert.equal(result.sourceUrl, "https://example.com/favicon.svg");
  assert.match(result.bytes.toString("utf8"), /#078dee/);
  assert.equal(detectWebsiteIconMimeType(Buffer.from("<svg/>")), null);
});

test("rejects unsafe SVG and falls back to a raster favicon", async () => {
  const result = await discoverWebsiteIcon("https://example.com", {
    resolver: async () => [PUBLIC_ADDRESS],
    requester: async (request) => {
      if (request.url.pathname === "/") return response(200, '<link rel="icon" href="/unsafe.svg">');
      if (request.url.pathname === "/unsafe.svg") return response(200, '<svg><script>alert(1)</script></svg>');
      if (request.url.pathname === "/favicon.ico") return response(200, ICO);
      return response(404);
    },
  });
  assert.equal(result.mimeType, "image/x-icon");
  assert.equal(result.sourceUrl, "https://example.com/favicon.ico");
});

test("loads the exact HTTPS DMIT artwork from the official domain mapping", async () => {
  const requests = [];
  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
    <svg width="100%" height="100%" viewBox="0 0 7459 2134" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <path fill="#0064ff" d="M0 0h2134v2134H0z"/>
      <use xlink:href="#mark"/>
      <path fill="#fff" d="M2600 300h4800v1500H2600z"/>
      <defs><image id="mark" width="10" height="10" xlink:href="data:image/png;base64,${PNG.toString("base64")}"/></defs>
    </svg>`);
  const result = await discoverOfficialDomainIcon("dmit.io", {
    resolver: async (hostname) => {
      assert.equal(hostname, "www.dmit.io");
      return [PUBLIC_ADDRESS];
    },
    requester: async (request) => {
      requests.push(request.url.toString());
      return response(200, svg, { "content-type": "text/plain" });
    },
  });

  assert.deepEqual(requests, ["https://www.dmit.io/templates/dmit_theme_2020/dmit/assets/images/dmit_logo_with_text.svg"]);
  assert.equal(result?.website, "https://dmit.io/");
  assert.equal(result?.domain, "dmit.io");
  assert.equal(result?.title, "DMIT");
  assert.equal(result?.mimeType, "image/svg+xml");
  const safeSvg = result?.bytes.toString("utf8") ?? "";
  assert.doesNotMatch(safeSvg, /<\?xml|<!doctype/i);
  assert.match(safeSvg, /viewBox="0 0 2134 2134"/);
  assert.match(safeSvg, /overflow="hidden"/);
  assert.match(safeSvg, /data:image\/png;base64,/);
  assert.match(result?.upstreamSha256 ?? "", /^[0-9a-f]{64}$/);
});

test("loads the VMISS raster favicon through its official-domain mapping", async () => {
  const result = await discoverOfficialDomainIcon("https://app.vmiss.com/index.php", {
    resolver: async (hostname) => {
      assert.equal(hostname, "www.vmiss.com");
      return [PUBLIC_ADDRESS];
    },
    requester: async (request) => {
      assert.equal(request.url.toString(), "https://www.vmiss.com/wp-content/uploads/2023/11/favicon.ico");
      return response(200, ICO);
    },
  });
  assert.equal(result?.mappedDomain, "vmiss.com");
  assert.equal(result?.title, "VMISS");
  assert.equal(result?.mimeType, "image/x-icon");
  assert.deepEqual(result?.bytes, ICO);
});

test("official mappings reject lookalike domains, redirects, and unsafe SVG", async () => {
  let requestCount = 0;
  const unknown = await discoverOfficialDomainIcon("https://dmit.io.attacker.example", {
    requester: async () => {
      requestCount += 1;
      return response(200, "");
    },
  });
  assert.equal(unknown, null);
  assert.equal(requestCount, 0);

  await assert.rejects(
    discoverOfficialDomainIcon("https://www.dmit.io", {
      resolver: async () => [PUBLIC_ADDRESS],
      requester: async () => response(302, "", { location: "https://cdn.attacker.example/icon.svg" }),
    }),
    expectDiscoveryError("TOO_MANY_REDIRECTS"),
  );

  await assert.rejects(
    discoverOfficialDomainIcon("dmit.io", {
      resolver: async () => [PUBLIC_ADDRESS],
      requester: async () => response(200, '<svg><script>alert(1)</script></svg>'),
    }),
    expectDiscoveryError("NO_ICON"),
  );
});
