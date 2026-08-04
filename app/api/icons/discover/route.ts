import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "../../../../lib/auth";
import { discoverAndIndexWebsiteIcon, iconDiscoveryStatus } from "../../../../lib/icon-discovery-service.server";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 8_192) throw new Error("请求内容过大");
    const body = await request.json() as { website?: unknown };
    const result = await discoverAndIndexWebsiteIcon(session.user.id, body.website);
    return NextResponse.json({ icon: result.icon }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "官网图标获取失败" },
      { status: iconDiscoveryStatus(error) },
    );
  }
}
