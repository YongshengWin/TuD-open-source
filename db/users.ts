import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from ".";
import { user, userAvatars } from "./schema";
import type { ValidatedProfilePatch } from "../lib/profile-values";
import { isSupportedCurrency, type SupportedCurrency } from "../lib/subscription-options";

export type UserProfile = {
  name: string;
  email: string;
  image: string | null;
};

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const [profile] = await db
    .select({ name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return profile ?? null;
}

export async function updateUserProfile(userId: string, patch: ValidatedProfilePatch): Promise<UserProfile> {
  return db.transaction(async (tx) => {
    let image: string | null | undefined;
    let avatarHash: string | undefined;
    if (patch.avatar === null) {
      image = null;
    } else if (patch.avatar) {
      avatarHash = createHash("sha256").update(patch.avatar.bytes).digest("hex");
      image = `/api/profile/avatar?v=${avatarHash.slice(0, 20)}`;
    }

    const [profile] = await tx
      .update(user)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(image !== undefined ? { image } : {}),
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId))
      .returning({ name: user.name, email: user.email, image: user.image });
    if (!profile) throw new Error("账户不存在");

    if (patch.avatar === null) {
      await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    } else if (patch.avatar && avatarHash) {
      const values = {
        userId,
        contentBase64: patch.avatar.bytes.toString("base64"),
        mimeType: patch.avatar.mimeType,
        byteSize: patch.avatar.bytes.length,
        width: patch.avatar.width,
        height: patch.avatar.height,
        sha256: avatarHash,
        updatedAt: new Date(),
      };
      await tx.insert(userAvatars).values(values).onConflictDoUpdate({
        target: userAvatars.userId,
        set: {
          contentBase64: values.contentBase64,
          mimeType: values.mimeType,
          byteSize: values.byteSize,
          width: values.width,
          height: values.height,
          sha256: values.sha256,
          updatedAt: values.updatedAt,
        },
      });
    }
    return profile;
  });
}

export async function getUserAvatar(userId: string) {
  const [avatar] = await db
    .select({
      contentBase64: userAvatars.contentBase64,
      mimeType: userAvatars.mimeType,
      byteSize: userAvatars.byteSize,
      sha256: userAvatars.sha256,
    })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .limit(1);
  return avatar ?? null;
}

export async function getUserSummaryCurrency(userId: string): Promise<SupportedCurrency> {
  const [record] = await db.select({ summaryCurrency: user.summaryCurrency }).from(user).where(eq(user.id, userId)).limit(1);
  return isSupportedCurrency(record?.summaryCurrency) ? record.summaryCurrency : "CNY";
}

export async function updateUserSummaryCurrency(userId: string, value: unknown): Promise<SupportedCurrency> {
  const summaryCurrency = typeof value === "string" ? value.toUpperCase() : "";
  if (!isSupportedCurrency(summaryCurrency)) throw new Error("暂不支持该币种");
  const [updated] = await db.update(user).set({ summaryCurrency, updatedAt: new Date() })
    .where(eq(user.id, userId)).returning({ summaryCurrency: user.summaryCurrency });
  if (!updated) throw new Error("账户不存在");
  return summaryCurrency;
}
