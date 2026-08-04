# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    BETTER_AUTH_URL=http://localhost:3000 \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-secret
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ARG APP_REVISION=unknown
LABEL org.opencontainers.image.title="TuD" \
      org.opencontainers.image.revision="${APP_REVISION}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Sharp uses fontconfig when rendering the server-generated subscription ticket.
RUN apk add --no-cache font-wqy-zenhei

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# The standalone trace contains application DB code in server chunks. The
# one-shot migration command imports these two packages directly.
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations
COPY --from=builder --chown=nextjs:nodejs /app/scripts/preflight-env.mjs ./scripts/preflight-env.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start-container.mjs ./scripts/start-container.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/send-subscription-reminders.mjs ./scripts/send-subscription-reminders.mjs

USER nextjs
EXPOSE 3000
CMD ["node", "scripts/start-container.mjs"]
