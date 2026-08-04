import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { reorderSubscriptions } from "../../../../db/subscriptions";
import { auth } from "../../../../lib/auth";
import { SubscriptionOrderValidationError } from "../../../../lib/subscription-order";

async function ownerId() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  return currentSession?.user.id ?? null;
}

export async function PATCH(request: Request) {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json() as { ids?: unknown };
    const ids = await reorderSubscriptions(userId, body.ids);
    return NextResponse.json({ ids });
  } catch (error) {
    if (error instanceof SubscriptionOrderValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to reorder subscriptions", error);
    return NextResponse.json({ error: "保存排序失败，请稍后重试" }, { status: 500 });
  }
}
