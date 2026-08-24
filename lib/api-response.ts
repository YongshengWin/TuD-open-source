type TextResponse = Pick<Response, "text">;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readApiJsonObject(response: TextResponse, fallbackError: string) {
  let body: unknown;

  try {
    const text = await response.text();
    if (!text.trim()) throw new Error("Empty response");
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error(fallbackError);
  }

  if (!isJsonObject(body)) throw new Error(fallbackError);
  return body;
}
