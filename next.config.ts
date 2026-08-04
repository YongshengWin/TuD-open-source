import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Public brand assets are copied into the production image separately. The
  // ticket renderer reads them at runtime, so tracing a duplicate copy would
  // needlessly enumerate the entire generated catalog.
  outputFileTracingExcludes: {
    "/api/ai/v1/ticket": ["./public/brands/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/brands/simple/:version/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
