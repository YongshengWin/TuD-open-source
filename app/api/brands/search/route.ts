import { NextResponse } from "next/server";
import { searchBrands } from "../../../../lib/brand-catalog.server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
  const limit = Number(searchParams.get("limit") ?? 24);
  try {
    return NextResponse.json(
      { query, items: await searchBrands(query, limit) },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    console.error("Failed to search the server icon catalog", error);
    return NextResponse.json({ error: "图标库暂时不可用" }, { status: 503 });
  }
}
