import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { deliverDueSubscriptionReminders } from "../../../../db/subscription-reminders";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.REMINDER_CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await deliverDueSubscriptionReminders();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
