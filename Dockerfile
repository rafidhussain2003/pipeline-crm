# --- Dependencies ---
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders — real values are supplied at runtime via env vars.
# Next.js only needs these present (not correct) to complete the build.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV JWT_SECRET="placeholder-build-time-secret"
ENV ENCRYPTION_KEY="placeholder-build-time-key"
ENV FACEBOOK_VERIFY_TOKEN="placeholder"
ENV FACEBOOK_APP_ID="placeholder"
ENV FACEBOOK_APP_SECRET="placeholder"
RUN npm run build

# --- Runtime ---
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin

USER nextjs
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
