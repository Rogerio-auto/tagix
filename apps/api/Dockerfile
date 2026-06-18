# syntax=docker/dockerfile:1.7
# @hm/api — Express 5 + Socket.io. Executado via `tsx` (TS direto, sem passo de
# build). Contexto de build = RAIZ do monorepo (pnpm workspaces).
#   docker build -f apps/api/Dockerfile -t leadium-api:latest .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

# --- deps: instala o workspace inteiro (frozen). `tsx` é devDep e roda em
# runtime, então NÃO filtramos --prod aqui. ---
FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- runtime ---
FROM deps AS runtime
ENV NODE_ENV=production
ENV API_PORT=3001
USER node
WORKDIR /app/apps/api
EXPOSE 3001
# Healthcheck real: /health valida DB + Redis (200 ok / 503 degraded).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "run", "start:prod"]
