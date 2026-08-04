import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { nexDueSql?: ReturnType<typeof postgres> };

const client = globalForDb.nexDueSql ?? postgres(
  process.env.DATABASE_URL ?? "postgresql://nexdue:nexdue@localhost:5432/nexdue",
  { max: 10, idle_timeout: 20, connect_timeout: 10, prepare: false },
);

if (process.env.NODE_ENV !== "production") globalForDb.nexDueSql = client;

export const db = drizzle(client, { schema });
