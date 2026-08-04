import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { updateUserSummaryCurrency } from "../../../db/users";
import { auth } from "../../../lib/auth";

export async function PATCH(request: Request) {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { summaryCurrency?: unknown };
    const summaryCurrency = await updateUserSummaryCurrency(currentSession.user.id, body.summaryCurrency);
    return NextResponse.json({ summaryCurrency });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
