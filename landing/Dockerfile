# syntax=docker/dockerfile:1.7
# Leadium landing — Vite/React → nginx (apex leadium.com.br).
# Standalone: NÃO faz parte do pnpm workspace (deps próprias via npm).
#   contexto de build = ./landing
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY . .
# URL do app (CTAs "entrar"/"começar" apontam pro produto).
ARG VITE_APP_URL=https://app.leadium.com.br
ARG VITE_CADASTRO_URL=https://app.leadium.com.br
ENV VITE_APP_URL=${VITE_APP_URL}
ENV VITE_CADASTRO_URL=${VITE_CADASTRO_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
