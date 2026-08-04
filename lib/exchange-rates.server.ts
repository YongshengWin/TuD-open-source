import "server-only";
import { currencyOptions } from "./subscription-options";

const RATE_ENDPOINT = "https://open.er-api.com/v6/latest/USD";

type OpenRateResponse = {
  result?: unknown;
  time_last_update_utc?: unknown;
  rates?: unknown;
};

export async function getUsdExchangeRates() {
  const response = await fetch(RATE_ENDPOINT, {
    headers: { accept: "application/json" },
    next: { revalidate: 6 * 60 * 60 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("汇率服务暂不可用");
  const body = await response.json() as OpenRateResponse;
  if (body.result !== "success" || !body.rates || typeof body.rates !== "object") throw new Error("汇率数据格式不正确");

  const supported = new Set<string>(currencyOptions.map((option) => option.value));
  const rates = Object.fromEntries(Object.entries(body.rates).filter(([currency, rate]) => (
    supported.has(currency) && typeof rate === "number" && Number.isFinite(rate) && rate > 0
  )));
  rates.USD = 1;
  return {
    base: "USD",
    rates,
    updatedAt: typeof body.time_last_update_utc === "string" ? body.time_last_update_utc : null,
    source: "ExchangeRate-API",
    sourceUrl: "https://www.exchangerate-api.com",
  };
}
