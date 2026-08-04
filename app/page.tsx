import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../lib/auth";
import { listSubscriptions } from "../db/subscriptions";
import { listCategories } from "../db/categories";
import { Dashboard } from "./components/Dashboard";
import { getUserSummaryCurrency } from "../db/users";
import { canUseSubscriptionReminders } from "../lib/subscription-reminder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TuD — 订阅管理",
  description: "清晰掌握每一次续费，让订阅始终可控。",
};

export default async function Home() {
  const currentSession = await auth.api.getSession({ headers: await headers() });
  if (!currentSession) redirect("/login");
  const [subscriptions, categories, summaryCurrency] = await Promise.all([
    listSubscriptions(currentSession.user.id),
    listCategories(currentSession.user.id),
    getUserSummaryCurrency(currentSession.user.id),
  ]);

  return (
    <Dashboard
      initialSubscriptions={subscriptions}
      initialCategories={categories.map((category) => category.name)}
      displayName={currentSession.user.name}
      profileImage={currentSession.user.image}
      reminderEligible={canUseSubscriptionReminders(currentSession.user.email)}
      initialSummaryCurrency={summaryCurrency}
    />
  );
}
