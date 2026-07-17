---
id: F56-S30
title: Agente — wizard interpola respostas no prompt do template
phase: F56
status: done
priority: high
estimated_size: S
depends_on: []
blocks: [F56-S31]
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T22:28:44Z

---
# F56-S30 — Wizard de agente personaliza o prompt (AG-03)

> **Origem:** AUDITORIA_TECNICA.md §3.3. O wizard coleta `answers` mas o `createSchema` não declara o campo (Zod strip descarta) e o handler usa o `promptTemplate` cru — o agente criado sai genérico. A etapa "Perguntas" é decorativa.

## Objetivo

Fazer as respostas do wizard personalizarem de fato o system prompt do agente na criação.

## Contexto / causa raiz (verificada)

`AgentCreationWizard.tsx:160-166` envia `answers`; `crud.ts:147-151` não declara `answers` (strip); `crud.ts:257` usa `tpl.promptTemplate` sem interpolar.

## Escopo (faz)

- Aceitar `answers` no `createSchema`.
- Renderizar `promptTemplate` com as variáveis (`{{q.key}}`) server-side na criação; validar variáveis obrigatórias.
- Ajustar o wizard se necessário para casar as chaves.

## Escopo (não faz)

- Versionamento de prompt (F56-S31 — depende deste). Runtime Python (F56-S01/S11).

## Arquivos permitidos

- `apps/api/src/routes/agents/crud.ts`
- `apps/web/features/agents/wizard/**`

## Arquivos proibidos

- `apps/api/src/routes/agents/index.ts` · `apps/api/src/routes/agents/versions.ts` (F56-S31)

## Definition of Done

- [ ] Criar agente pelo wizard produz system prompt com as respostas interpoladas (teste).
- [ ] Variáveis obrigatórias sem resposta são rejeitadas com mensagem clara.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Este slot é dono de `crud.ts`; F56-S31 (versionamento) adiciona o hook de gravar versão no PATCH depois — por isso S31 depende deste.
