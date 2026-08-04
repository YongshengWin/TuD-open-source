import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getUserAvatar } from "../../../../db/users";
import { auth } from "../../../../lib/auth";

export const runtime = "nodejs";

async function ownerId() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  return currentSession?.user.id ?? null;
}

export async function GET(request: Request) {
  const userId = await ownerId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const avatar = await getUserAvatar(userId);
  if (!avatar) {
    return NextResponse.json({ error: "头像不存在" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const requestedVersion = new URL(request.url).searchParams.get("v");
  const version = avatar.sha256.slice(0, 20);
  if (requestedVersion && requestedVersion !== version) {
    return NextResponse.json({ error: "头像版本已更新" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const etag = `"sha256-${avatar.sha256}"`;
  const cacheControl = requestedVersion
    ? "private, max-age=31536000, immutable"
    : "private, no-cache";
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { "Cache-Control": cacheControl, ETag: etag, Vary: "Cookie" },
    });
  }

  const bytes = Buffer.from(avatar.contentBase64, "base64");
  if (bytes.length !== avatar.byteSize) {
    console.error("Stored avatar byte length does not match its metadata", { userId });
    return NextResponse.json({ error: "头像数据损坏" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Length": String(bytes.length),
      "Content-Type": avatar.mimeType,
      "Cross-Origin-Resource-Policy": "same-origin",
      ETag: etag,
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
