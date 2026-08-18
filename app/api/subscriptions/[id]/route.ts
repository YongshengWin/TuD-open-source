import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getSubscription, permanentlyDeleteSubscription, updateSubscription } from "../../../../db/subscriptions";
import { auth } from "../../../../lib/auth";
import { canUseSubscriptionReminders } from "../../../../lib/subscription-reminder";

async function owner() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const currentSession = await owner();
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const subscription = await getSubscription(currentSession.user.id, id);
  if (!subscription) return NextResponse.json({ error: "订阅不存在" }, { status: 404 });
  return NextResponse.json(subscription);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const currentSession = await owner();
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await context.params;
    const allowReminder = canUseSubscriptionReminders(currentSession.user.email);
    return NextResponse.json(await updateSubscription(currentSession.user.id, id, await request.json(), allowReminder));
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新失败";
    return NextResponse.json({ error: message }, { status: message === "订阅不存在" ? 404 : 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const currentSession = await owner();
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { confirm?: unknown } | null;
  if (body?.confirm !== id) {
    return NextResponse.json({ error: "请确认要永久删除此订阅" }, { status: 400 });
  }
  try {
    return NextResponse.json({ deleted: await permanentlyDeleteSubscription(currentSession.user.id, id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    return NextResponse.json({ error: message }, { status: message === "订阅不存在" ? 404 : 400 });
  }
}
