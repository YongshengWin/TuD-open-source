import assert from "node:assert/strict";
import test from "node:test";
import { readApiJsonObject } from "../lib/api-response.ts";

const fallbackError = "官网图标获取失败，请稍后重试";

test("reads JSON objects regardless of the response content-type", async () => {
  const response = new Response(JSON.stringify({ icon: { iconId: "website:example.com" } }), {
    headers: { "Content-Type": "text/plain" },
  });

  assert.deepEqual(await readApiJsonObject(response, fallbackError), {
    icon: { iconId: "website:example.com" },
  });
});

test("replaces HTML API responses with a stable user-facing error", async () => {
  const response = new Response("<!DOCTYPE html><title>Internal Server Error</title>", {
    status: 500,
    headers: { "Content-Type": "text/html" },
  });

  await assert.rejects(
    readApiJsonObject(response, fallbackError),
    (error) => error instanceof Error
      && error.message === fallbackError
      && !error.message.includes("Unexpected token"),
  );
});

test("replaces empty and non-object JSON API responses with the fallback error", async () => {
  for (const body of [null, "", "null", "[]", "true"]) {
    const response = new Response(body, { status: 502 });
    await assert.rejects(
      readApiJsonObject(response, fallbackError),
      (error) => error instanceof Error && error.message === fallbackError,
    );
  }
});

test("keeps valid JSON error payloads available to the caller", async () => {
  const response = new Response(JSON.stringify({ error: "官网图标获取过于频繁，请稍后再试" }), {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });

  assert.deepEqual(await readApiJsonObject(response, fallbackError), {
    error: "官网图标获取过于频繁，请稍后再试",
  });
});
