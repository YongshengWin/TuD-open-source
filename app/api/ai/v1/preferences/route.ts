import { getUserSummaryCurrency, updateUserSummaryCurrency } from "../../../../../db/users";
import { authorizeAiRequest } from "../../../../../lib/ai-api-auth.server";
import { aiJson, readAiJson, unauthorizedAiResponse } from "../../../../../lib/ai-api.server";
import { canUseSubscriptionReminders } from "../../../../../lib/subscription-reminder";

export async function GET(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  return aiJson({
    summaryCurrency: await getUserSummaryCurrency(identity.userId),
    reminderEligible: canUseSubscriptionReminders(identity.email),
  });
}

export async function PATCH(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    return aiJson({ summaryCurrency: await updateUserSummaryCurrency(identity.userId, body.summaryCurrency) });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "偏好保存失败" }, { status: 400 });
  }
}
