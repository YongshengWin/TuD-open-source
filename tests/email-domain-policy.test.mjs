import assert from "node:assert/strict";
import test from "node:test";
import { composeRegistrationEmail, isAllowedRegistrationEmail } from "../lib/email-domain-policy.ts";

test("allows mainstream public email domains for registration", () => {
  for (const email of [
    "user@gmail.com",
    "user@outlook.com",
    "user@qq.com",
    "user@163.com",
    "user@icloud.com",
    "USER@PROTON.ME",
  ]) assert.equal(isAllowedRegistrationEmail(email), true, email);
});

test("composes registration emails only from a local part and supported dropdown domain", () => {
  assert.equal(composeRegistrationEmail(" Alice ", "gmail.com"), "alice@gmail.com");
  assert.equal(composeRegistrationEmail("alice@evil.test", "gmail.com"), null);
  assert.equal(composeRegistrationEmail("alice", "company.example"), null);
  assert.equal(composeRegistrationEmail("", "qq.com"), null);
});

test("rejects custom, lookalike, subdomain, and malformed registration emails", () => {
  for (const email of [
    "user@company.example",
    "user@gmail.com.example",
    "user@mail.gmail.com",
    "user@gmail.co",
    "gmail.com",
    "@gmail.com",
  ]) assert.equal(isAllowedRegistrationEmail(email), false, email);
});
