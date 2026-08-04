import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  summaryCurrency: text("summary_currency").notNull().default("CNY"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiApiKeys = pgTable("ai_api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("ai_api_keys_token_hash_unique").on(table.tokenHash),
  index("ai_api_keys_user_created_idx").on(table.userId, table.createdAt),
]);

export const userAvatars = pgTable("user_avatars", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  contentBase64: text("content_base64").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const emailDeliveryDaily = pgTable("email_delivery_daily", {
  deliveryDay: text("delivery_day").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  deliveryCount: integer("delivery_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.deliveryDay, table.recipientEmail] }),
  check("email_delivery_daily_count_check", sql`${table.deliveryCount} >= 0`),
  index("email_delivery_daily_day_idx").on(table.deliveryDay),
]);

export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull().unique(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  aaguid: text("aaguid"),
}, (table) => [index("passkey_user_id_idx").on(table.userId)]);

export const iconAssets = pgTable("icon_assets", {
  sha256: text("sha256").primaryKey(),
  contentBase64: text("content_base64").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width"),
  height: integer("height"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const iconCatalog = pgTable("icon_catalog", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  upstreamKey: text("upstream_key").notNull(),
  displayName: text("display_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  searchText: text("search_text").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  priority: integer("priority").notNull().default(1_000),
  mimeType: text("mime_type"),
  license: text("license"),
  sourcePage: text("source_page"),
  sourceRevision: text("source_revision"),
  assetUrl: text("asset_url"),
  websiteDomain: text("website_domain"),
  accent: text("accent"),
  assetSha256: text("asset_sha256").references(() => iconAssets.sha256, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("icon_catalog_provider_upstream_key_unique").on(table.provider, table.upstreamKey),
  index("icon_catalog_normalized_name_idx").on(table.normalizedName),
  index("icon_catalog_provider_active_idx").on(table.provider, table.isActive, table.priority),
  index("icon_catalog_website_domain_idx").on(table.websiteDomain),
  index("icon_catalog_asset_sha256_idx").on(table.assetSha256),
]);

export const iconCatalogState = pgTable("icon_catalog_state", {
  provider: text("provider").primaryKey(),
  seedVersion: text("seed_version").notNull(),
  entryCount: integer("entry_count").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  seededAt: timestamp("seeded_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  iconId: text("icon_id").references(() => iconCatalog.id, { onDelete: "set null" }),
  iconKey: text("icon_key").notNull().default("fallback"),
  groupName: text("group_name").notNull().default("其他"),
  amountMinor: integer("amount_minor"),
  currencyCode: text("currency_code").notNull().default("CNY"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  dueDate: text("due_date"),
  accent: text("accent").notNull().default("violet"),
  cardAccent: text("card_accent"),
  accountName: text("account_name"),
  website: text("website"),
  notes: text("notes").notNull().default(""),
  reminderEnabled: boolean("reminder_enabled").notNull().default(false),
  sortPosition: integer("sort_position").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("subscriptions_card_accent_hex_check", sql`${table.cardAccent} IS NULL OR ${table.cardAccent} ~ '^[0-9a-f]{6}$'`),
  index("idx_subscriptions_user_due").on(table.userId, table.isArchived, table.dueDate),
  index("idx_subscriptions_user_sort").on(table.userId, table.isArchived, table.sortPosition),
  index("idx_subscriptions_icon").on(table.iconId),
]);

export const subscriptionReminderDeliveries = pgTable("subscription_reminder_deliveries", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  dueDate: text("due_date").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("subscription_reminder_deliveries_status_check", sql`${table.status} IN ('pending', 'sent')`),
  uniqueIndex("subscription_reminder_deliveries_subscription_due_unique").on(table.subscriptionId, table.dueDate),
  index("subscription_reminder_deliveries_status_idx").on(table.status, table.updatedAt),
]);

export const subscriptionCategories = pgTable("subscription_categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortPosition: integer("sort_position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_subscription_categories_user").on(table.userId),
  index("idx_subscription_categories_user_sort").on(table.userId, table.sortPosition),
  uniqueIndex("subscription_categories_user_name_unique").on(table.userId, table.name),
]);
