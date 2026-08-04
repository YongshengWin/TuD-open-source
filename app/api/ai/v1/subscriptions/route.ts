import { createSubscription, listSubscriptionsByStatus } from "../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../lib/ai-api-auth.server";
import { aiJson, publicSubscription, readAiJson, subscriptionInputFromAi, unauthorizedAiResponse } from "../../../../../lib/ai-api.server";
import { parseSubscriptionStatus } from "../../../../../lib/ai-api-contract";
import { canUseSubscriptionReminders } from "../../../../../lib/subscription-reminder";

export async function GET(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const status = parseSubscriptionStatus(new URL(request.url).searchParams.get("status"));
    const items = await listSubscriptionsByStatus(identity.userId, status);
    return aiJson({ subscriptions: items.map(publicSubscription), count: items.length, status });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "查询失败" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const input = subscriptionInputFromAi(await readAiJson(request));
    const created = await createSubscription(identity.userId, input, canUseSubscriptionReminders(identity.email));
    return aiJson({ subscription: publicSubscription(created) }, { status: 201 });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}
