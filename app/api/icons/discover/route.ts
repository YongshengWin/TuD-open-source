import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "../../../../lib/auth";
import {
  discoverAndIndexWebsiteIcon,
  iconDiscoveryRetryAfter,
  iconDiscoveryStatus,
} from "../../../../lib/icon-discovery-service.server";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 8_192) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
    let body: { website?: unknown };
    try {
      const parsed = await request.json() as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid JSON object");
      body = parsed as { website?: unknown };
    } catch {
      return NextResponse.json({ error: "请求内容格式不正确" }, { status: 400 });
    }
    const result = await discoverAndIndexWebsiteIcon(session.user.id, body.website);
    return NextResponse.json({ icon: result.icon }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const status = iconDiscoveryStatus(error);
    const retryAfterSeconds = iconDiscoveryRetryAfter(error);
    return NextResponse.json(
      { error: status === 500 || !(error instanceof Error) ? "官网图标获取失败" : error.message },
      {
        status,
        ...(retryAfterSeconds === null ? {} : { headers: { "Retry-After": String(retryAfterSeconds) } }),
      },
    );
  }
}
