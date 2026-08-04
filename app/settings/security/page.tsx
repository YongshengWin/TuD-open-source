import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../../../db";
import { account } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { SecurityPanel } from "./security-panel";

export default async function SecurityPage() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) redirect("/login");
  const [credentialAccount] = await db.select({ id: account.id }).from(account).where(and(
    eq(account.userId, currentSession.user.id),
    eq(account.providerId, "credential"),
    isNotNull(account.password),
  )).limit(1);
  return <SecurityPanel name={currentSession.user.name} email={currentSession.user.email} initialHasPassword={Boolean(credentialAccount)} />;
}
