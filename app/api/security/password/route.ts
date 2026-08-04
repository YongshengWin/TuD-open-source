import { and, eq, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { account, passkey } from "../../../../db/schema";
import { auth } from "../../../../lib/auth";

export async function DELETE(request: Request) {
  const requestHeaders = await headers();
  const currentSession = await auth.api.getSession({ headers: requestHeaders });
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2_048) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
    const body = await request.json() as { currentPassword?: unknown };
    if (typeof body.currentPassword !== "string" || body.currentPassword.length < 10 || body.currentPassword.length > 128) {
      return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });
    }

    try {
      await auth.api.verifyPassword({ body: { password: body.currentPassword }, headers: requestHeaders });
    } catch {
      return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
    }

    const removed = await db.transaction(async (transaction) => {
      const [remainingPasskey] = await transaction.select({ id: passkey.id }).from(passkey)
        .where(eq(passkey.userId, currentSession.user.id)).limit(1);
      if (!remainingPasskey) return false;
      const deleted = await transaction.delete(account).where(and(
        eq(account.userId, currentSession.user.id),
        eq(account.providerId, "credential"),
        isNotNull(account.password),
      )).returning({ id: account.id });
      return deleted.length > 0;
    });

    if (!removed) {
      return NextResponse.json({ error: "必须先添加至少一个 Passkey，才能删除密码登录" }, { status: 409 });
    }
    return NextResponse.json({ status: true });
  } catch {
    return NextResponse.json({ error: "暂时无法删除密码登录" }, { status: 400 });
  }
}
