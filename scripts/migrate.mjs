import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertProductionEnvironment } from "./preflight-env.mjs";

assertProductionEnvironment();

const connection = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
  prepare: false,
});

try {
  await migrate(drizzle(connection), { migrationsFolder: "migrations" });
  console.info("TuD database migrations are up to date.");
} finally {
  await connection.end({ timeout: 5 });
}
