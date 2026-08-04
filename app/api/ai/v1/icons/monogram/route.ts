import { createOrGetMonogramIcon } from "../../../../../../db/icons";
import { authorizeAiRequest } from "../../../../../../lib/ai-api-auth.server";
import { aiJson, readAiJson, unauthorizedAiResponse } from "../../../../../../lib/ai-api.server";
import { monogramTextFromIconId, normalizeMonogramAccent } from "../../../../../../lib/monogram-icon";

export async function POST(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    const record = await createOrGetMonogramIcon(body.text, body.accent ?? body.color);
    if (!record?.catalog) throw new Error("字母图标创建失败");
    const text = monogramTextFromIconId(record.catalog.id);
    if (!text) throw new Error("字母图标创建失败");
    return aiJson({ icon: {
      iconId: record.catalog.id,
      title: text,
      accent: normalizeMonogramAccent(record.catalog.accent, text),
      source: "monogram",
      sourceLabel: "字母图标",
      text,
    } }, { status: 201 });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "字母图标创建失败" }, { status: 400 });
  }
}
