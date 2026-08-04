import { NextResponse } from "next/server";
import { cacheIconAsset, getIconById } from "../../../../db/icons";
import { loadIconAsset } from "../../../../lib/icon-asset-loader.server";

function assetResponse(bytes: Buffer, mimeType: string, sha256: string, request: Request) {
  const etag = `"sha256-${sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Content-Type": mimeType,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    let record = await getIconById(id);
    if (!record?.catalog || !record.catalog.isActive) {
      return NextResponse.json({ error: "图标不存在" }, { status: 404 });
    }

    if (!record.asset) {
      if (
        !record.catalog.assetUrl
        || !record.catalog.mimeType
        || !["hd-icons", "dashboard-icons", "lobe-icons", "selfhst-icons"].includes(record.catalog.provider)
      ) {
        return NextResponse.json({ error: "图标资源不可用" }, { status: 404 });
      }
      const loaded = await loadIconAsset({
        provider: record.catalog.provider,
        assetUrl: record.catalog.assetUrl,
        mimeType: record.catalog.mimeType,
        accent: record.catalog.accent,
      });
      record = await cacheIconAsset(record.catalog.id, {
        contentBase64: loaded.bytes.toString("base64"),
        mimeType: loaded.mimeType,
        metadata: {
          assetUrl: record.catalog.assetUrl,
          sourceRevision: record.catalog.sourceRevision,
          cachedAt: new Date().toISOString(),
        },
      }) ?? null;
    }

    if (!record?.asset) return NextResponse.json({ error: "图标资源不可用" }, { status: 404 });
    return assetResponse(
      Buffer.from(record.asset.contentBase64, "base64"),
      record.asset.mimeType,
      record.asset.sha256,
      request,
    );
  } catch (error) {
    console.error("Failed to serve indexed icon", error);
    return NextResponse.json({ error: "图标加载失败" }, { status: 502 });
  }
}
