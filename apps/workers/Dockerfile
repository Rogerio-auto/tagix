# syntax=docker/dockerfile:1.7
# @hm/workers — 5 consumers + scheduler (RabbitMQ). Executado via `tsx`.
# Sem ingress (não fala com o Traefik). Contexto de build = RAIZ do monorepo.
#   docker build -f apps/workers/Dockerfile -t leadium-workers:latest .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/workers
# Sem HEALTHCHECK HTTP: workers não servem porta pública. A resiliência vem do
# restart_policy do Swarm + shutdown gracioso (SIGTERM) no bootstrap.
CMD ["pnpm", "run", "start:prod"]
