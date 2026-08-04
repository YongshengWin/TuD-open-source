import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listAiApiKeys } from "../../../db/ai-api-keys";
import { auth } from "../../../lib/auth";
import { AiSettingsPanel } from "./ai-settings-panel";

export const metadata = {
  title: "AI 连接 — TuD",
  description: "用专属 AI Key 安全地连接 TuD。",
};

export default async function AiSettingsPage() {
  const requestHeaders = await headers();
  const currentSession = await auth.api.getSession({ headers: requestHeaders });
  if (!currentSession) redirect("/login");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const requestOrigin = `${protocol}://${host}`;
  const configuredOrigin = process.env.TUD_PUBLIC_URL?.trim().replace(/\/$/, "")
    || process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "")
    || requestOrigin;
  let apiOrigin = requestOrigin;
  try {
    apiOrigin = new URL(configuredOrigin).origin;
  } catch {
    // Production preflight validates BETTER_AUTH_URL; keep development usable if it is malformed.
  }
  return <AiSettingsPanel name={currentSession.user.name} initialKeys={await listAiApiKeys(currentSession.user.id)} origin={apiOrigin} />;
}
