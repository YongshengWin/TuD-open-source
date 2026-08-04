import { restoreSubscription } from "../../../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../../../lib/ai-api-auth.server";
import { aiJson, publicSubscription, unauthorizedAiResponse } from "../../../../../../../lib/ai-api.server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const { id } = await context.params;
    return aiJson({ subscription: publicSubscription(await restoreSubscription(identity.userId, id)) });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "恢复失败" }, { status: 400 });
  }
}
