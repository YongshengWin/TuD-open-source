import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { updateSubscriptionReminders } from "../../../../db/subscriptions";
import { auth } from "../../../../lib/auth";
import { canUseSubscriptionReminders, normalizeSubscriptionReminderUpdates } from "../../../../lib/subscription-reminder";

export async function PATCH(request: Request) {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseSubscriptionReminders(currentSession.user.email)) {
    return NextResponse.json({ error: "当前账号未开启邮件提醒权限" }, { status: 403 });
  }

  try {
    const updates = normalizeSubscriptionReminderUpdates(await request.json());
    return NextResponse.json(await updateSubscriptionReminders(currentSession.user.id, updates));
  } catch (error) {
    const message = error instanceof Error ? error.message : "提醒设置保存失败";
    return NextResponse.json(
      { error: message },
      { status: message === "订阅列表已变化，请刷新后重试" ? 409 : 400 },
    );
  }
}
