import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getUserProfile, updateUserProfile } from "../../../db/users";
import { auth } from "../../../lib/auth";
import { parseProfilePatch, ProfileInputError, readLimitedJson } from "../../../lib/profile-values";

export const runtime = "nodejs";

async function ownerId() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  return currentSession?.user.id ?? null;
}

function json(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const userId = await ownerId();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getUserProfile(userId);
  if (!profile) return json({ error: "账户不存在" }, { status: 404 });
  return json(profile);
}

export async function PATCH(request: Request) {
  const userId = await ownerId();
  if (!userId) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const patch = parseProfilePatch(await readLimitedJson(request));
    return json(await updateUserProfile(userId, patch));
  } catch (error) {
    if (error instanceof ProfileInputError) return json({ error: error.message }, { status: 400 });
    console.error("Failed to update profile", error);
    return json({ error: "账户更新失败" }, { status: 500 });
  }
}
