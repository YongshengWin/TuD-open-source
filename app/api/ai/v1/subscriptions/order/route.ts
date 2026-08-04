import { reorderSubscriptions } from "../../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../../lib/ai-api-auth.server";
import { aiJson, readAiJson, unauthorizedAiResponse } from "../../../../../../lib/ai-api.server";

export async function PATCH(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    return aiJson({ ids: await reorderSubscriptions(identity.userId, body.ids) });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "排序失败" }, { status: 400 });
  }
}
