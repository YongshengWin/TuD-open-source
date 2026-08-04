import { listCategories } from "../../../../../db/categories";
import { listSubscriptions } from "../../../../../db/subscriptions";
import { getUserSummaryCurrency } from "../../../../../db/users";
import { authorizeAiRequest } from "../../../../../lib/ai-api-auth.server";
import { aiJson, publicSubscription, readAiJson, unauthorizedAiResponse } from "../../../../../lib/ai-api.server";
import { getUsdExchangeRates } from "../../../../../lib/exchange-rates.server";
import { isSupportedCurrency } from "../../../../../lib/subscription-options";
import { convertMonthlySpend, monthlySpendByCurrency } from "../../../../../lib/subscription-display";
import { groupSubscriptionsByCategory } from "../../../../../lib/subscription-order";
import { renderSubscriptionTicketPng } from "../../../../../lib/subscription-ticket-image.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = await authorizeAiRequest(request);
  if (!identity) return unauthorizedAiResponse();
  try {
    const body = await readAiJson(request);
    const format = body.format === undefined ? "png" : body.format;
    if (format !== "png" && format !== "json") throw new Error("format 只能是 png 或 json");
    const selectedIds = body.selectedIds === undefined ? null : body.selectedIds;
    if (selectedIds !== null && (!Array.isArray(selectedIds) || selectedIds.some((id) => typeof id !== "string"))) {
      throw new Error("selectedIds 必须是订阅 ID 数组");
    }
    const [all, categories, savedCurrency] = await Promise.all([
      listSubscriptions(identity.userId),
      listCategories(identity.userId),
      getUserSummaryCurrency(identity.userId),
    ]);
    const selectedSet = selectedIds ? new Set(selectedIds as string[]) : null;
    const selected = selectedSet ? all.filter((item) => selectedSet.has(item.id)) : all;
    if (!selected.length) throw new Error("订阅票至少需要一项订阅");
    if (selectedSet && selected.length !== selectedSet.size) throw new Error("selectedIds 中包含不存在的订阅");

    const summaryCurrency = typeof body.summaryCurrency === "string" ? body.summaryCurrency.toUpperCase() : savedCurrency;
    if (!isSupportedCurrency(summaryCurrency)) throw new Error("暂不支持该汇总币种");
    const monthlyByCurrency = monthlySpendByCurrency(selected);
    let monthlyTotal: number | null = null;
    let rateUpdatedAt: string | null = null;
    if (monthlyByCurrency.length) {
      if (monthlyByCurrency.length === 1 && monthlyByCurrency[0].currency === summaryCurrency) {
        monthlyTotal = monthlyByCurrency[0].amount;
      } else {
        const rateData = await getUsdExchangeRates();
        monthlyTotal = convertMonthlySpend(monthlyByCurrency, summaryCurrency, rateData.rates);
        rateUpdatedAt = rateData.updatedAt;
      }
    }
    if (monthlyByCurrency.length && monthlyTotal === null) throw new Error("部分币种暂时无法换算");

    const ordered = groupSubscriptionsByCategory(selected, categories.map((item) => item.name));
    const groupedRecords = ordered.reduce<Array<{ name: string; subscriptions: typeof ordered }>>((groups, item) => {
      const current = groups.at(-1);
      if (current?.name === item.groupName) current.subscriptions.push(item);
      else groups.push({ name: item.groupName, subscriptions: [item] });
      return groups;
    }, []);
    const today = new Date().toISOString().slice(0, 10);
    const nearestDueDate = selected.map((item) => item.dueDate).filter((date): date is string => Boolean(date && date >= today)).sort()[0] ?? null;
    const generatedAt = new Date();
    const number = `TUD-${today.replaceAll("-", "")}-${String(selected.length).padStart(2, "0")}`;
    const total = monthlyTotal === null ? null : { currencyCode: summaryCurrency, amount: monthlyTotal };

    if (format === "png") {
      const png = await renderSubscriptionTicketPng({
        number,
        generatedAt,
        nearestDueDate,
        monthlyTotal: total,
        groups: groupedRecords,
      });
      return new Response(new Uint8Array(png), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename="TuD-ticket-${today}.png"`,
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
          "X-TuD-Ticket-Number": number,
        },
      });
    }

    const grouped = groupedRecords.map((group) => ({
      name: group.name,
      subscriptions: group.subscriptions.map(publicSubscription),
    }));

    return aiJson({
      ticket: {
        number,
        generatedAt: generatedAt.toISOString(),
        subscriptionCount: selected.length,
        nearestDueDate,
        monthlyTotal: total,
        monthlyByCurrency,
        exchangeRateUpdatedAt: rateUpdatedAt,
        groups: grouped,
      },
    });
  } catch (error) {
    return aiJson({ error: "invalid_request", message: error instanceof Error ? error.message : "订阅票生成失败" }, { status: 400 });
  }
}
