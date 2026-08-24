import { authorizeAiRequest } from "../../../../../../lib/ai-api-auth.server";
import { aiJson, readAiJson, unauthorizedAiResponse } from "../../../../../../lib/ai-api.server";
import {
  discoverAndIndexWebsiteIcon,
  iconDiscoveryRetryAfter,
  iconDiscoveryStatus,
} from "../../../../../../lib/icon-discovery-service.server";

export async function POST(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    const result = await discoverAndIndexWebsiteIcon(identity.userId, body.website);
    return aiJson({ icon: result.icon }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const retryAfterSeconds = iconDiscoveryRetryAfter(error);
    return aiJson(
      { error: "icon_discovery_failed", message: error instanceof Error ? error.message : "官网图标获取失败" },
      {
        status: iconDiscoveryStatus(error),
        ...(retryAfterSeconds === null ? {} : { headers: { "Retry-After": String(retryAfterSeconds) } }),
      },
    );
  }
}
