---
id: F57-S08
title: Secrets do Swarm em vez de env vars no service spec
phase: F57
status: available
priority: medium
estimated_size: M
depends_on: []
blocks: []
agent_id: security-auditor
source_docs:
  - infra/docker/docker-compose.prod.yml
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S08 — 20+ segredos de produção vivem como env vars no spec do serviço

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08).

## Objetivo

Mover segredos de produção de variáveis de ambiente para Docker Swarm secrets
(montados como arquivo, criptografados no Raft, sem aparecer em `inspect`).

## Contexto / causa raiz (verificada)

O bloco `x-app-env` de `infra/docker/docker-compose.prod.yml:14-56` injeta como
**variável de ambiente**: `PG_PASSWORD` (via `DATABASE_URL`), `RABBITMQ_PASSWORD`,
`SUPABASE_SERVICE_KEY`, `ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
`AGENT_RUNTIME_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
`R2_SECRET_ACCESS_KEY`, `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`,
`TURNSTILE_SECRET_KEY`.

O que o repo já faz certo: nada disso é hardcoded — tudo vem de `${VAR}`, com
`.env` de deploy na VPS fora do git, e `.env.production.example` com placeholders.
**Isso está correto.** O problema é o mecanismo de entrega, não o armazenamento:

- Env var de serviço Swarm fica **em claro** no spec, legível por
  `docker service inspect leadium_api` para qualquer usuário no grupo `docker`.
- Fica em `/proc/<pid>/environ` do container — visível a qualquer processo do mesmo
  namespace e a qualquer crash dumper.
- Vaza em stack trace, em log de crash, e em qualquer biblioteca que despeje o
  ambiente em relatório de erro (o stack já tem Sentry).
- `ENCRYPTION_KEY` é a chave-mestra do AES-256-GCM at-rest: seu vazamento
  desfaz a criptografia de todos os segredos de tenant guardados no banco.

Docker Swarm secrets resolvem exatamente isto: cifrados no Raft, montados em
`/run/secrets/<nome>` (tmpfs), não aparecem em `inspect`, e têm rotação por
versionamento de secret.

## Escopo (faz)

- Declarar bloco `secrets:` no `docker-compose.prod.yml` para cada segredo real.
- Adaptar a leitura no código: helper que lê `VAR_FILE` (caminho) com fallback para
  `VAR` (env) — padrão `_FILE` consagrado, mantém dev local funcionando com `.env`
  sem ramificação de lógica.
- Aplicar em `apps/api`, `apps/workers` e `apps/agent-runtime` (Python).
- Documentar criação e **rotação** dos secrets em
  `docs/runbooks/deploy-production.md` (Swarm não atualiza secret in-place —
  precisa de sufixo de versão, mesma armadilha já documentada para os `configs`).
- Ajustar `scripts/deploy.sh` para não exportar segredos no ambiente do
  `docker compose build` quando não forem build args legítimos.

## Escopo (não faz)

- Gerenciador externo (Vault, Infisical, Doppler). Overkill para single-node hoje;
  o helper `_FILE` deixa a porta aberta para depois.
- Variáveis `NEXT_PUBLIC_*` e o DSN do Sentry — **públicos por design**, não são
  segredos e não devem virar secret.
- `CORS_ORIGIN`, `APP_PUBLIC_URL`, `LOG_LEVEL`, feature flags — config, não segredo.

## Arquivos permitidos

- `infra/docker/docker-compose.prod.yml`
- `.env.production.example`
- `packages/shared/src/config/**`
- `apps/api/src/config/**`
- `apps/workers/src/config/**`
- `apps/agent-runtime/app/config.py`
- `apps/agent-runtime/app/settings.py`
- `scripts/deploy.sh`
- `docs/runbooks/deploy-production.md`
- `docs/runbooks/rotate-encryption-key.md`
- `docs/runbooks/rotate-openrouter-key.md`

## Definition of Done

- [ ] `docker service inspect leadium_api` **não** exibe nenhum valor de segredo.
- [ ] Todo segredo listado acima chega via `/run/secrets/*`.
- [ ] Dev local continua funcionando por `.env`, sem `if (isProd)` espalhado.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm -r test` verdes; `uv run pytest` verde.
- [ ] Runbooks de rotação atualizados com o procedimento de versionamento de secret.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm -r --if-present test
docker compose -f infra/docker/docker-compose.prod.yml config
```

## Notas

- Ordem sugerida: helper `_FILE` primeiro (com teste), depois um serviço por vez,
  `ENCRYPTION_KEY` por último — é o de maior consequência se a leitura falhar.
- `AGENT_RUNTIME_TOKEN` é compartilhado entre api e agent-runtime: o **mesmo** secret
  montado nos dois serviços, não dois secrets.
