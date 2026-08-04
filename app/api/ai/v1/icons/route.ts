import { authorizeAiRequest } from "../../../../../lib/ai-api-auth.server";
import { aiJson, unauthorizedAiResponse } from "../../../../../lib/ai-api.server";
import { searchBrands } from "../../../../../lib/brand-catalog.server";

export async function GET(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 64);
    const limit = Number(searchParams.get("limit") ?? 12);
    const icons = await searchBrands(query, limit);
    return aiJson({ query, icons, count: icons.length });
  } catch (error) {
    return aiJson({ error: "icon_catalog_unavailable", message: error instanceof Error ? error.message : "图标库暂时不可用" }, { status: 503 });
  }
}
