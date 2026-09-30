import { collectMemberPayment } from "../../../../../../../../../db/subscriptions";
import { authorizeAiRequest } from "../../../../../../../../../lib/ai-api-auth.server";
import { aiJson, publicSubscription, readAiJson, unauthorizedAiResponse } from "../../../../../../../../../lib/ai-api.server";

export async function POST(request: Request, context: { params: Promise<{ id: string; memberId: string }> }) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();

  try {
    const { id, memberId } = await context.params;
    const body = await readAiJson(request);
    const unknownFields = Object.keys(body).filter((key) => key !== "expectedDueDate");
    if (unknownFields.length) throw new Error(`不支持的字段：${unknownFields.join("、")}`);
    if (typeof body.expectedDueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expectedDueDate)) {
      throw new Error("请提供本次收款日期");
    }
    const result = await collectMemberPayment(identity.userId, id, memberId, body.expectedDueDate);
    return aiJson({ subscription: publicSubscription(result.subscription), payment: result.payment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "标记收款失败";
    const notFound = message === "订阅不存在" || message === "收款成员不存在";
    const conflict = message === "收款日期已变化，请刷新后重试";
    return aiJson(
      { error: notFound ? "not_found" : conflict ? "conflict" : "invalid_request", message },
      { status: notFound ? 404 : conflict ? 409 : 400 },
    );
  }
}
