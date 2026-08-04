import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { getUsdExchangeRates } from "../../../lib/exchange-rates.server";

export async function GET() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getUsdExchangeRates(), {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "汇率服务暂不可用" }, { status: 503 });
  }
}
