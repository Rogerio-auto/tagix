---
id: F38-S15
title: Auditoria de segurança da fase (RLS, gates, XSS MD, scopes)
phase: F38
status: available
priority: critical
estimated_size: M
depends_on:
  - F38-S04
  - F38-S05
  - F38-S06
  - F38-S09
  - F38-S11
  - F38-S13
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: security-auditor
---
# F38-S15 — Auditoria de segurança da fase

## Objetivo

Auditar toda a superfície nova da fase: RLS, gates de platform-admin, isolamento cross-workspace, XSS no render de Markdown, scopes da API pública, autorização de join de socket. Produzir achados priorizados.

## Contexto

Superfícies sensíveis: conteúdo de ajuda platform-level (escrita gated, leitura universal); `support_threads`/`support_messages` (RLS de tenant + bypass platform); novos endpoints v1 (API key + scope + tenant); render de Markdown de artigo (XSS); rooms de socket de suporte.

## Escopo (faz) — somente leitura/análise + relatório

- **RLS**: help content global-read sem vazar drafts; `help_article_feedback`/`support_*` isolados por workspace; platform bypass intencional e gated.
- **Gates**: `requirePlatformAdmin` em todas as rotas `/platform/help` e `/platform/support`; tentativa não-admin negada **e auditada**.
- **IDOR**: `assertThreadVisible` em todo `/api/support/threads/:id/*` → 404.
- **XSS**: corpo de artigo renderizado **sanitizado** (sem `<script>`/`<iframe>`/handlers inline/`javascript:`); CMS preview = mesmo sanitizador.
- **API v1**: cada novo endpoint exige o scope correto (403 sem ele); rate limit por chave aplica; sem vazamento cross-tenant.
- **Socket**: join de `support:thread:<id>` autorizado por visibilidade; `support:platform` só platform-admin.

## Arquivos permitidos

- `tasks/COMMS.md` (relatório append-only)
- `docs/runbooks/**` (se um runbook for necessário)

## Arquivos proibidos

- Código de produção (auditoria é read-only; correções viram sub-slots).

## Definition of Done

- [ ] Achados priorizados (crítico/alto/médio/baixo) em COMMS.md, cada um com arquivo:linha e remediação.
- [ ] Zero crítico/alto em aberto **ou** sub-slots de correção abertos para os altos.
- [ ] Confirmação explícita de: gates, RLS, XSS sanitização, scopes, join autorizado.

## Notas

Espelhar o rigor da auditoria da F30 (que pegou 2 IDORs altos). Qualquer correção sai por sub-slot do agente dono do arquivo — auditor não edita produção.
</content>
