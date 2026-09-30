import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { collectMemberPayment } from "../../../../../../../db/subscriptions";
import { auth } from "../../../../../../../lib/auth";

export async function POST(request: Request, context: { params: Promise<{ id: string; memberId: string }> }) {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, memberId } = await context.params;
  try {
    const body = await request.json() as { expectedDueDate?: unknown };
    return NextResponse.json(await collectMemberPayment(currentSession.user.id, id, memberId, body?.expectedDueDate), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "标记收款失败";
    const status = message === "订阅不存在" || message === "收款成员不存在" ? 404
      : message === "收款日期已变化，请刷新后重试" ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
