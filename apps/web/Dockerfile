# syntax=docker/dockerfile:1.7
# @hm/web — Next.js 15 (App Router). Build standalone (output self-contained).
# Contexto de build = RAIZ do monorepo (pnpm workspaces).
#   docker build -f apps/web/Dockerfile -t leadium-web:latest .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="/pnpm:$PATH"
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

# --- build: instala e compila o Next em modo standalone ---
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true
# Embedded Signup da Meta (NEXT_PUBLIC = inlinado no build do browser).
ARG NEXT_PUBLIC_META_APP_ID=
ARG NEXT_PUBLIC_META_CONFIG_ID=
ENV NEXT_PUBLIC_META_APP_ID=${NEXT_PUBLIC_META_APP_ID}
ENV NEXT_PUBLIC_META_CONFIG_ID=${NEXT_PUBLIC_META_CONFIG_ID}
# Cloudflare Turnstile (captcha do signup — NEXT_PUBLIC = inlinado no build do browser).
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
# Alvo do proxy SSR (/api, /auth, /socket.io). O Next CONGELA os rewrites no
# routes-manifest em BUILD-TIME, então isto PRECISA existir no build — env de
# runtime é ignorado pelo manifest já gerado. Default = nome do serviço no Swarm.
ARG API_PROXY_TARGET=http://api:3001
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @hm/web build

# --- runtime: só o necessário do standalone (imagem mínima) ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# O standalone traz server.js + node_modules mínimos rastreados pelo Next.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# `/` pode redirecionar (login); aceitamos qualquer resposta < 500 como "vivo".
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
