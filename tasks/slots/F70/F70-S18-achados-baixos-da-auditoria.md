---
id: F70-S18
title: Achados baixos da auditoria pré-deploy — marcadores de origem, referências restantes e guarda do seed
phase: F70
status: available
priority: medium
estimated_size: S
depends_on: [F70-S11]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S11-referencias-cruzadas-entre-workspaces.md
---
# F70-S18 — Achados baixos da auditoria pré-deploy

> Auditoria de segurança de 25/09 sobre `origin/main..main` (fase F70). Os achados H1, M1 e L8 estão na F70-S15; M2, L3, L5, L6 e L7 ficam na F70-S19 (tocam arquivos em uso pela S15 e pela S16).

## Objetivo

Fechar os achados baixos que não colidem com slots em andamento.

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/origin.ts`
- `packages/channels/src/meta/whatsapp/origin.test.ts`
- `packages/shared/src/conversation-origin*.ts`
- `packages/db/src/tenant-refs.ts`
- `packages/db/src/tenant-refs.test.ts`
- `apps/api/src/routes/campaigns/**`
- `apps/api/src/routes/org/**`
- `apps/api/src/routes/agents/**`
- `packages/db/src/seed/agent_templates_arcada.run.ts`

## Escopo (faz)

- **L1:** o marcador de site/IG casa só como prefixo da mensagem (depois de trim e normalização) e aceita um token não natural (ex.: `[ref:site-7f3a]`), documentado para o link `wa.me?text=`. O mínimo de 8 caracteres continua.
- **L4:** `requireRefsInWorkspace` em `campaigns/crud.ts` (`aiHandoffAgentId`), `org/org.ts` (`departmentId(s)`) e `agents/crud.ts:92`; `department` entra no `REF_TABLES`. Resposta igual para "não existe" e "é de outro workspace", como na S11.
- **L9:** a guarda do seed da Arcada exige `NODE_ENV !== 'production'` e confirma pelo nome do banco, além do hostname.

## Definition of Done

- [ ] teste: marcador no meio da mensagem não classifica; no início, classifica; token funciona
- [ ] teste cross-tenant para cada rota de L4
- [ ] teste: guarda do seed recusa `NODE_ENV=production` e banco com nome de produção
