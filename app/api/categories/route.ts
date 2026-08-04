import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { createCategory, deleteCategory, listCategories, reorderCategories } from "../../../db/categories";

async function ownerId() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  return currentSession?.user.id ?? null;
}

export async function GET() {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listCategories(userId));
}

export async function POST(request: Request) {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { name } = await request.json() as { name?: string };
    return NextResponse.json({ name: await createCategory(userId, name ?? "") }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { names } = await request.json() as { names?: unknown };
    return NextResponse.json({ names: await reorderCategories(userId, names) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存分类顺序失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const userId = await ownerId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { name, replacement } = await request.json() as { name?: string; replacement?: string };
    return NextResponse.json(await deleteCategory(userId, name, replacement));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}
