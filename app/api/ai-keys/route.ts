import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createAiApiKey, listAiApiKeys, revokeAiApiKey } from "../../../db/ai-api-keys";
import { auth } from "../../../lib/auth";

async function ownerId() {
  return (await auth.api.getSession({ headers: await headers() }))?.user.id ?? null;
}

export async function GET() {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listAiApiKeys(userId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { name?: unknown };
    return NextResponse.json(await createAiApiKey(userId, body.name), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { id?: unknown };
  if (typeof body.id !== "string") return NextResponse.json({ error: "缺少 Key ID" }, { status: 400 });
  const removed = await revokeAiApiKey(userId, body.id);
  return removed
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "Key 不存在" }, { status: 404 });
}
