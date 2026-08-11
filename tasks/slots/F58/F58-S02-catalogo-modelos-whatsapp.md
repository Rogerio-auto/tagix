---
id: F58-S02
title: Guardar o catálogo de modelos de mensagem do WhatsApp
phase: F58
status: done
priority: critical
estimated_size: M
depends_on: [F58-S01, F57-S01]
blocks: [F58-S03]
agent_id: agent-f58-s02
source_docs:
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/DATA_MODEL.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-08-11T14:20:41Z
completed_at: 2026-08-11T14:30:44Z

---
# F58-S02 — Guardar o catálogo de modelos de mensagem do WhatsApp

## Objetivo

Criar uma fonte local, multi-tenant e consultável para os modelos sincronizados da
Meta. Campanhas não devem consultar a Graph API modelo por modelo nem depender de
um nome digitado manualmente.

## Escopo

### files_allowed

- `packages/db/src/schema/channel-message-templates.ts`
- `packages/db/src/schema/channels.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/index.ts`
- `packages/db/drizzle/0067_f58_channel_message_templates.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/src/channel-message-templates*.test.ts`
- `tasks/slot.config.json`
- `docs/DATA_MODEL.md`

### files_forbidden

- `apps/**`
- `packages/db/drizzle/meta/*_snapshot.json`

## Definition of Done

- [ ] Tabela `channel_message_templates` guarda workspace, canal, id externo, nome, idioma, categoria, status, componentes, motivo de rejeição e `last_synced_at`.
- [ ] Unicidade por canal + nome + idioma e índices para lista por status/categoria.
- [ ] FK para canal/workspace e deleção coerente.
- [ ] A integridade impede associar `workspace_id` de um tenant ao canal de outro tenant.
- [ ] Estado de sincronização por canal preserva o último sucesso mesmo quando o catálogo está vazio ou uma tentativa falha.
- [ ] RLS criada, forçada e testada para isolamento entre workspaces.
- [ ] Componentes externos permanecem `unknown` validado; zero `any`.
- [ ] Migration idempotente e registrada conforme o guard de migrations.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
python scripts/slot.py check-migrations
```

## Notas

- O catálogo é cache operacional da Meta; o identificador remoto continua sendo a referência externa.
