import { archiveSubscription, getSubscription, getSubscriptionIncludingArchived, permanentlyDeleteSubscription, updateSubscription } from "../../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../../lib/ai-api-auth.server";
import { aiJson, publicSubscription, readAiJson, subscriptionInputFromAi, unauthorizedAiResponse } from "../../../../../../lib/ai-api.server";
import { canUseSubscriptionReminders } from "../../../../../../lib/subscription-reminder";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  const { id } = await context.params;
  const item = await getSubscriptionIncludingArchived(identity.userId, id);
  return item
    ? aiJson({ subscription: publicSubscription(item) })
    : aiJson({ error: "not_found", message: "订阅不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const { id } = await context.params;
    const current = await getSubscription(identity.userId, id);
    if (!current) return aiJson({ error: "not_found", message: "订阅不存在" }, { status: 404 });
    const input = subscriptionInputFromAi(await readAiJson(request), current.currencyCode);
    const updated = await updateSubscription(identity.userId, id, input, canUseSubscriptionReminders(identity.email));
    return aiJson({ subscription: publicSubscription(updated) });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "更新失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const { id } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const permanent = searchParams.get("permanent") === "true";
    if (permanent) {
      if (searchParams.get("confirm") !== id) throw new Error("永久删除必须在 confirm 参数中再次提供订阅 ID");
      const deleted = await permanentlyDeleteSubscription(identity.userId, id);
      return aiJson({ deleted, permanent: true });
    }
    const archived = await archiveSubscription(identity.userId, id);
    return aiJson({ subscription: publicSubscription(archived), permanent: false });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}
