import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from ".";
import { aiApiKeys, user } from "./schema";

const MAX_KEYS_PER_USER = 5;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export type AiApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export function hashAiApiKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeKeyName(value: unknown) {
  if (typeof value !== "string") return "AI 助手";
  return value.trim().replace(/\s+/g, " ").slice(0, 40) || "AI 助手";
}

export async function listAiApiKeys(userId: string): Promise<AiApiKeyRecord[]> {
  return db.select({
    id: aiApiKeys.id,
    name: aiApiKeys.name,
    prefix: aiApiKeys.tokenPrefix,
    createdAt: aiApiKeys.createdAt,
    lastUsedAt: aiApiKeys.lastUsedAt,
  }).from(aiApiKeys).where(eq(aiApiKeys.userId, userId)).orderBy(aiApiKeys.createdAt);
}

export async function createAiApiKey(userId: string, rawName: unknown) {
  const token = `tud_ai_${randomBytes(32).toString("base64url")}`;
  const prefix = `${token.slice(0, 14)}…`;
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tud:ai-keys:${userId}`}, 0))`);
    const [{ value }] = await tx.select({ value: count() }).from(aiApiKeys).where(eq(aiApiKeys.userId, userId));
    if ((value ?? 0) >= MAX_KEYS_PER_USER) throw new Error(`每个账户最多创建 ${MAX_KEYS_PER_USER} 个 AI Key`);
    const [record] = await tx.insert(aiApiKeys).values({
      id: crypto.randomUUID(),
      userId,
      name: normalizeKeyName(rawName),
      tokenHash: hashAiApiKey(token),
      tokenPrefix: prefix,
    }).returning({
      id: aiApiKeys.id,
      name: aiApiKeys.name,
      prefix: aiApiKeys.tokenPrefix,
      createdAt: aiApiKeys.createdAt,
      lastUsedAt: aiApiKeys.lastUsedAt,
    });
    return record;
  });
  return { ...created, token };
}

export async function revokeAiApiKey(userId: string, id: string) {
  const [removed] = await db.delete(aiApiKeys)
    .where(and(eq(aiApiKeys.id, id), eq(aiApiKeys.userId, userId)))
    .returning({ id: aiApiKeys.id });
  return Boolean(removed);
}

export async function authenticateAiApiKey(token: string) {
  if (!/^tud_ai_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [identity] = await db.select({
    keyId: aiApiKeys.id,
    userId: aiApiKeys.userId,
    email: user.email,
  }).from(aiApiKeys)
    .innerJoin(user, eq(user.id, aiApiKeys.userId))
    .where(eq(aiApiKeys.tokenHash, hashAiApiKey(token)))
    .limit(1);
  if (!identity) return null;

  const staleBefore = new Date(Date.now() - LAST_USED_WRITE_INTERVAL_MS);
  try {
    await db.update(aiApiKeys).set({ lastUsedAt: new Date() })
      .where(and(eq(aiApiKeys.id, identity.keyId), or(isNull(aiApiKeys.lastUsedAt), lt(aiApiKeys.lastUsedAt, staleBefore))));
  } catch (error) {
    console.error("Failed to update AI key usage", error);
  }
  return identity;
}
