FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate

RUN mkdir -p uploads/statements uploads/temp public/uploads/avatars \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["sh", "entrypoint.sh"]
