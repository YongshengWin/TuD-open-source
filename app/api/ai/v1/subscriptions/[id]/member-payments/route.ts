import { listMemberPayments } from "../../../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../../../lib/ai-api-auth.server";
import { aiJson, unauthorizedAiResponse } from "../../../../../../../lib/ai-api.server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();

  try {
    const { id } = await context.params;
    const cursor = new URL(request.url).searchParams.get("cursor");
    return aiJson(await listMemberPayments(identity.userId, id, cursor));
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取收款记录失败";
    const notFound = message === "订阅不存在";
    return aiJson({ error: notFound ? "not_found" : "invalid_request", message }, { status: notFound ? 404 : 400 });
  }
}
