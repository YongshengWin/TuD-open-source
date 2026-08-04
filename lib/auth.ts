import "server-only";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { emailOTP } from "better-auth/plugins/email-otp";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "../db";
import * as schema from "../db/schema";
import { sendAuthOtp } from "./email.server";
import { assertAuthEmailAvailable, EmailQuotaError } from "./email-quota.server";
import { isAllowedRegistrationEmail, REGISTRATION_EMAIL_DOMAIN_ERROR } from "./email-domain-policy";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

function throwAuthQuotaError(error: unknown): never {
  if (error instanceof EmailQuotaError) {
    throw APIError.from("TOO_MANY_REQUESTS", { code: error.code, message: error.message });
  }
  throw error;
}

async function sendQuotaAwareAuthOtp(message: Parameters<typeof sendAuthOtp>[0]) {
  try {
    await sendAuthOtp(message);
  } catch (error) {
    throwAuthQuotaError(error);
  }
}

export const auth = betterAuth({
  appName: "TuD",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  hooks: {
    before: createAuthMiddleware(async (context) => {
      const quotaProtectedPaths = new Set([
        "/sign-up/email",
        "/email-otp/request-password-reset",
        "/forget-password/email-otp",
      ]);
      if (!quotaProtectedPaths.has(context.path)) return;
      const email = typeof context.body?.email === "string" ? context.body.email : "";
      if (!email) return;
      if (context.path === "/sign-up/email" && !isAllowedRegistrationEmail(email)) {
        throw APIError.from("BAD_REQUEST", { code: "EMAIL_DOMAIN_NOT_ALLOWED", message: REGISTRATION_EMAIL_DOMAIN_ERROR });
      }
      try {
        await assertAuthEmailAvailable(email);
      } catch (error) {
        throwAuthQuotaError(error);
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // Sign-up accepts an optional image field upstream. Ignore it so every
        // avatar still goes through the authenticated, validated profile API.
        before: async (newUser) => ({ data: { ...newUser, image: null } }),
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  emailVerification: {
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 10,
  },
  // Profile updates use /api/profile so avatar bytes are validated and stored
  // outside the session-facing user row.
  disabledPaths: ["/update-user", "/change-email"],
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  advanced: { cookiePrefix: "nexdue", useSecureCookies: baseURL.startsWith("https://") },
  plugins: [
    passkey({ rpID: new URL(baseURL).hostname, rpName: "TuD", origin: baseURL }),
    emailOTP({
      sendVerificationOTP: sendQuotaAwareAuthOtp,
      otpLength: 6,
      expiresIn: 60 * 10,
      allowedAttempts: 3,
      storeOTP: "encrypted",
      overrideDefaultEmailVerification: true,
      disableSignUp: true,
      changeEmail: { enabled: true, verifyCurrentEmail: true },
      rateLimit: { window: 60, max: 3 },
    }),
    nextCookies(),
  ],
});
