import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { createSubscription, listSubscriptions, renewSubscription } from "../../../db/subscriptions";
import { canUseSubscriptionReminders } from "../../../lib/subscription-reminder";

async function owner() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET() {
  const currentSession = await owner();
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listSubscriptions(currentSession.user.id));
}

export async function POST(request: Request) {
  const currentSession = await owner();
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const allowReminder = canUseSubscriptionReminders(currentSession.user.email);
    const subscription = await createSubscription(currentSession.user.id, await request.json(), allowReminder);
    return NextResponse.json(subscription, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const currentSession = await owner();
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await request.json() as { id?: string };
    if (!id) throw new Error("缺少订阅 ID");
    return NextResponse.json(await renewSubscription(currentSession.user.id, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}
