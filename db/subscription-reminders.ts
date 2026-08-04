import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { billingCycleLabel, currencyFractionDigits, minorToMajor } from "../lib/subscription-options";
import { formatCurrencyAmount } from "../lib/subscription-display";
import { sendSubscriptionReminderEmail } from "../lib/email.server";
import { subscriptionReminderDueDate, subscriptionReminderEmails } from "../lib/subscription-reminder";
import { db } from "./index";
import { subscriptionReminderDeliveries, subscriptions, user } from "./schema";

type ReminderCandidate = {
  id: string;
  name: string;
  amountMinor: number | null;
  currencyCode: string;
  billingCycle: string;
  dueDate: string | null;
  recipientEmail: string;
};

async function claimDelivery(candidate: ReminderCandidate) {
  if (!candidate.dueDate) return null;
  const id = crypto.randomUUID();
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO subscription_reminder_deliveries
      (id, subscription_id, due_date, recipient_email, status, created_at, updated_at)
    VALUES
      (${id}, ${candidate.id}, ${candidate.dueDate}, ${candidate.recipientEmail}, 'pending', now(), now())
    ON CONFLICT (subscription_id, due_date) DO UPDATE
      SET updated_at = now()
      WHERE subscription_reminder_deliveries.status = 'pending'
        AND subscription_reminder_deliveries.updated_at < now() - interval '15 minutes'
    RETURNING id
  `);
  return result[0]?.id ?? null;
}

function reminderAmount(candidate: ReminderCandidate) {
  if (candidate.amountMinor == null) return "未记录";
  return formatCurrencyAmount(
    minorToMajor(candidate.amountMinor, candidate.currencyCode),
    candidate.currencyCode,
    currencyFractionDigits(candidate.currencyCode),
  );
}

export async function deliverDueSubscriptionReminders(now = new Date()) {
  const dueDate = subscriptionReminderDueDate(now);
  const recipientEmails = subscriptionReminderEmails();
  if (!recipientEmails.length) return { dueDate, candidates: 0, sent: 0, failed: 0 };
  const candidates = await db.select({
    id: subscriptions.id,
    name: subscriptions.name,
    amountMinor: subscriptions.amountMinor,
    currencyCode: subscriptions.currencyCode,
    billingCycle: subscriptions.billingCycle,
    dueDate: subscriptions.dueDate,
    recipientEmail: user.email,
  }).from(subscriptions)
    .innerJoin(user, eq(subscriptions.userId, user.id))
    .where(and(
      eq(subscriptions.isArchived, false),
      eq(subscriptions.reminderEnabled, true),
      eq(subscriptions.dueDate, dueDate),
      inArray(sql`lower(${user.email})`, recipientEmails),
    ))
    .orderBy(asc(subscriptions.name), asc(subscriptions.id));

  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const deliveryId = await claimDelivery(candidate);
    if (!deliveryId) continue;
    try {
      await sendSubscriptionReminderEmail({
        email: candidate.recipientEmail,
        serviceName: candidate.name,
        amount: reminderAmount(candidate),
        dueDate,
        billingCycle: billingCycleLabel(candidate.billingCycle),
      });
      await db.update(subscriptionReminderDeliveries)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(subscriptionReminderDeliveries.id, deliveryId));
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.delete(subscriptionReminderDeliveries)
        .where(and(eq(subscriptionReminderDeliveries.id, deliveryId), eq(subscriptionReminderDeliveries.status, "pending")));
      console.error(`Failed to send subscription reminder for ${candidate.id}`, error);
    }
  }

  return { dueDate, candidates: candidates.length, sent, failed };
}
