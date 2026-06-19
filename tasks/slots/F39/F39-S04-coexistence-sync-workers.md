---
id: F39-S04
title: Workers de sync de coexistência — echoes → conversas, import de histórico, app_state
phase: F39
status: review
priority: high
estimated_size: L
depends_on: [F39-S03]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
blocks: [F39-S05]
claimed_at: 2026-06-19T05:18:12Z
completed_at: 2026-06-19T05:27:38Z

---
# F39-S04 — Workers de sincronização de coexistência

> **source_docs:** `docs/features/LIVECHAT.md` (modelo de conversas/mensagens) · contrato de eventos de F39-S03
> **depende de:** F39-S03 (eventos `coexistence.echo` / `coexistence.history` / `coexistence.app_state`)

## Objetivo

Consumir os eventos de coexistência publicados em F39-S03 e materializá-los no domínio: (1) **echoes** — mensagens enviadas pelo número via app WhatsApp Business aparecem como **outbound** no thread da conversa; (2) **history import** — contatos e mensagens históricas importados de forma **idempotente**; (3) **app_state_sync** — estado do número/sessão refletido no `channel`.

## Contexto

Os workers vivem em `apps/workers/src/<worker>/` e são registrados no `bootstrap`. Este slot adiciona o(s) consumer(s) de coexistência. Persiste via repos de `@hm/db` já existentes (conversas/mensagens/contatos) — **sem migração de schema**: echoes/history mapeiam para mensagens com direção e metadado de origem já suportados; se um valor de enum novo for indispensável, abrir sub-slot de DB.

## Escopo (faz)

- `apps/workers/src/coexistence/**` (novo): consumer(s) dos eventos de F39-S03.
  - Echo → upsert da conversa pelo contato + insert de mensagem outbound (origem "app"), idempotente pelo id externo (dedup).
  - History batch → upsert idempotente de contatos + mensagens (dedup por id externo); tolerante a reprocesso.
  - App_state → atualiza estado/flags do `channel` (ex.: número conectado/desconectado).
- `apps/workers/src/bootstrap/index.ts`: registrar o(s) novo(s) worker(s) no boot (mesma forma de `startInboundWorker` etc.).

## Fora de escopo

- Parse/publish de webhook (F39-S03). Onboarding (F39-S01). UI (F39-S02). Mudanças de schema (reusar colunas existentes).

## Arquivos permitidos

- `apps/workers/src/coexistence/**`
- `apps/workers/src/bootstrap/index.ts`

## Arquivos proibidos

- `apps/api/**` · `packages/channels/**` · `packages/shared/src/mq/topology.ts` (F39-S03; aqui só **importa** os nomes de fila/contratos)
- `packages/db/src/schema/**` (sem migração)

## Contratos

- **Entrada:** consome `coexistence.echo` / `coexistence.history` / `coexistence.app_state` (contrato Zod de F39-S03).
- **Idempotência:** toda escrita é upsert por id externo (reprocesso não duplica) — DoD.

## Definition of Done

- [ ] Echo do app vira mensagem **outbound** na conversa correta (resolução por `phone_number_id` + contato), sem duplicar em reentrega.
- [ ] History import idempotente: rodar 2x não duplica contatos/mensagens.
- [ ] App_state reflete no `channel` (estado consultável).
- [ ] Worker(s) registrado(s) no `bootstrap`; shutdown gracioso (SIGTERM) preservado.
- [ ] `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Especialista: **backend-engineer**. Resolução de tenant/conversa por `phone_number_id` segue o padrão de `apps/api/src/routes/flows/submissions.ts` (canal → workspace).
- Idempotência é o risco central do history import — ancore dedup no id externo da mensagem/contato. Evitar N+1 em batches grandes.
- Cada `start*Worker` abre a própria conexão AMQP (ver `bootstrap`); siga o mesmo contrato de handle.
