import { createCategory, deleteCategory, listCategories, reorderCategories } from "../../../../../db/categories";
import { authorizeAiRequest } from "../../../../../lib/ai-api-auth.server";
import { aiJson, readAiJson, unauthorizedAiResponse } from "../../../../../lib/ai-api.server";

export async function GET(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  const categories = await listCategories(identity.userId);
  return aiJson({ categories: categories.map((item) => item.name) });
}

export async function POST(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    return aiJson({ name: await createCategory(identity.userId, body.name) }, { status: 201 });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "创建分类失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    return aiJson({ names: await reorderCategories(identity.userId, body.names) });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "分类排序失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    return aiJson(await deleteCategory(identity.userId, body.name, body.replacement));
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "删除分类失败" }, { status: 400 });
  }
}
