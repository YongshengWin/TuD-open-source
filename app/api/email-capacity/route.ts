import { NextResponse } from "next/server";
import { getEmailQuotaStatus } from "../../../lib/email-quota.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getEmailQuotaStatus();
    const announcement = process.env.PUBLIC_AUTH_ANNOUNCEMENT?.trim().slice(0, 240) || null;
    return NextResponse.json({ ...status, announcement }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to read email capacity", error);
    return NextResponse.json(
      { available: false, resetsAt: null, temporarilyUnavailable: true, announcement: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
