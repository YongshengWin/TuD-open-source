import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { billingCycleLabel, currencyFractionDigits, minorToMajor } from "../lib/subscription-options";
import { formatCurrencyAmount } from "../lib/subscription-display";
import { sendGroupedReminderEmail, sendSubscriptionReminderEmail } from "../lib/email.server";
import type { ReminderCharge } from "../lib/grouped-reminder-email";
import { memberIntervalLabel } from "../lib/member-schedules";
import { subscriptionReminderDueDate, subscriptionReminderEmails } from "../lib/subscription-reminder";
import { db } from "./index";
import { subscriptionReminderDeliveries, subscriptions, user } from "./schema";

async function claimDelivery(subscriptionId: string, dueDate: string, recipientEmail: string) {
  const id = crypto.randomUUID();
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO subscription_reminder_deliveries
      (id, subscription_id, due_date, recipient_email, status, created_at, updated_at)
    VALUES
      (${id}, ${subscriptionId}, ${dueDate}, ${recipientEmail}, 'pending', now(), now())
    ON CONFLICT (subscription_id, due_date) DO UPDATE
      SET updated_at = now()
      WHERE subscription_reminder_deliveries.status = 'pending'
        AND subscription_reminder_deliveries.updated_at < now() - interval '15 minutes'
    RETURNING id
  `);
  return result[0]?.id ?? null;
}

function reminderAmount(amountMinor: number | null, currencyCode: string) {
  if (amountMinor == null) return "未记录";
  return formatCurrencyAmount(
    minorToMajor(amountMinor, currencyCode),
    currencyCode,
    currencyFractionDigits(currencyCode),
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
    reminderEnabled: subscriptions.reminderEnabled,
    memberSchedules: subscriptions.memberSchedules,
    recipientEmail: user.email,
  }).from(subscriptions)
    .innerJoin(user, eq(subscriptions.userId, user.id))
    .where(and(
      eq(subscriptions.isArchived, false),
      inArray(sql`lower(${user.email})`, recipientEmails),
      or(
        and(eq(subscriptions.reminderEnabled, true), eq(subscriptions.dueDate, dueDate)),
        sql`${subscriptions.memberSchedules} @> ${JSON.stringify([{ nextDueDate: dueDate, reminderEnabled: true }])}::jsonb`,
      ),
    ))
    .orderBy(asc(subscriptions.name), asc(subscriptions.id));

  let sent = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const parentDue = candidate.reminderEnabled && candidate.dueDate === dueDate && candidate.billingCycle !== "lifetime";
    const memberCharges: ReminderCharge[] = candidate.memberSchedules
      .filter((member) => member.reminderEnabled === true && member.nextDueDate === dueDate)
      .map((member) => ({
        kind: "member",
        memberName: member.name,
        amount: reminderAmount(member.amountMinor, member.currencyCode),
        cycle: memberIntervalLabel(member.intervalCount, member.intervalUnit),
      }));
    if (!parentDue && !memberCharges.length) continue;

    const deliveryId = await claimDelivery(candidate.id, dueDate, candidate.recipientEmail);
    if (!deliveryId) continue;
    try {
      if (memberCharges.length) {
        await sendGroupedReminderEmail({
          email: candidate.recipientEmail,
          serviceName: candidate.name,
          dueDate,
          charges: [
            ...(parentDue ? [{ kind: "subscription" as const, amount: reminderAmount(candidate.amountMinor, candidate.currencyCode), cycle: billingCycleLabel(candidate.billingCycle) }] : []),
            ...memberCharges,
          ],
        });
      } else {
        await sendSubscriptionReminderEmail({
          email: candidate.recipientEmail,
          serviceName: candidate.name,
          amount: reminderAmount(candidate.amountMinor, candidate.currencyCode),
          dueDate,
          billingCycle: billingCycleLabel(candidate.billingCycle),
        });
      }
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
