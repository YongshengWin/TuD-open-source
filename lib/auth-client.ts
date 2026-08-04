"use client";

import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({ plugins: [emailOTPClient(), passkeyClient()] });
