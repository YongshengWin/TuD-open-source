import { renewSubscription } from "../../../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../../../lib/ai-api-auth.server";
import { aiJson, publicSubscription, unauthorizedAiResponse } from "../../../../../../../lib/ai-api.server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const { id } = await context.params;
    return aiJson({ subscription: publicSubscription(await renewSubscription(identity.userId, id)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "续费失败";
    return aiJson({ error: message === "订阅不存在" ? "not_found" : "invalid_request", message }, { status: message === "订阅不存在" ? 404 : 400 });
  }
}
