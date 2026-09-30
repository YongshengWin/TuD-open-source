import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { listMemberPayments } from "../../../../../db/subscriptions";
import { auth } from "../../../../../lib/auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return NextResponse.json(await listMemberPayments(currentSession.user.id, id, cursor), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取收款记录失败";
    return NextResponse.json({ error: message }, { status: message === "订阅不存在" ? 404 : 400 });
  }
}
