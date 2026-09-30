-- Preserve member order and existing fields while filling settings introduced
-- after a schedule was created. Recover a monthly anchor from its earliest
-- recorded payment when the schedule lacks anchorDay.
UPDATE "subscriptions" AS subscription
SET "member_schedules" = (
  SELECT jsonb_agg(
    member.value
      || CASE WHEN member.value ? 'reminderEnabled' THEN '{}'::jsonb ELSE '{"reminderEnabled":false}'::jsonb END
      || CASE WHEN member.value ? 'anchorDay' THEN '{}'::jsonb ELSE jsonb_build_object(
        'anchorDay', COALESCE(
          (SELECT right(payment."scheduled_due_date", 2)::integer
           FROM "subscription_member_payments" AS payment
           WHERE payment."subscription_id" = subscription."id"
             AND payment."member_id" = member.value->>'id'
           ORDER BY payment."scheduled_due_date" ASC
           LIMIT 1),
          right(member.value->>'nextDueDate', 2)::integer
        )
      ) END
    ORDER BY member.ordinality
  )
  FROM jsonb_array_elements(subscription."member_schedules") WITH ORDINALITY AS member(value, ordinality)
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(subscription."member_schedules") AS member(value)
  WHERE NOT member.value ? 'reminderEnabled' OR NOT member.value ? 'anchorDay'
);
