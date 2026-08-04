import "server-only";
import { authenticateAiApiKey } from "../db/ai-api-keys";

export function bearerTokenFromRequest(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() ?? null;
}

export async function authorizeAiRequest(request: Request) {
  const token = bearerTokenFromRequest(request);
  return token ? authenticateAiApiKey(token) : null;
}
