---
id: F49-S01
title: Delay de envio não-bloqueante no nó de mensagem (WAITING + compat)
phase: F49
status: available
priority: high
estimated_size: S
depends_on: []
blocks: [F49-S02]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
---

# F49-S01 — Delay de envio não-bloqueante no nó de mensagem

## Objetivo

Desacoplar o **delay de envio** da pré-ação (digitando/gravando) no nó `message`: introduzir o campo
`delayMs` que faz o handler esperar de forma **não-bloqueante** via `WAITING` + scheduler (mesma
mecânica do nó `wait`), sem o teto de 30s e sem segurar o flow-worker. A pré-ação continua cosmética e
limitada a 30s. Garantir **compat em runtime** dos flows legados (`preActionDurationMs > 30s`) tratando
o excedente como delay real, sem mutar versões publicadas.

## Contexto

Diagnóstico em prod (2026-06-26): o nó de mensagem só tinha o delay da pré-ação, **clampado em 30s**
(`PRE_ACTION_MAX_MS`) e bloqueante (`ctx.sleep`). Flows reais setaram 88s/78s/60s → silenciosamente
cortados para 30s ("não espera o delay definido"). O nó `wait` (`wait.handler.ts`) já prova o padrão
correto: retorna `WAITING` com `nextStepAt`, o scheduler (F4-S03) re-enfileira ao vencer — não segura o
worker e não tem teto. Reusar exatamente esse padrão no nó de mensagem.

## Escopo (faz)

- `message.handler.ts`:
  - Schema: novo campo `delayMs` (`z.number().min(0).max(MESSAGE_DELAY_MAX_MS).optional()`).
  - **Fase 1 (delay):** na 1ª entrada, resolver o delay efetivo (ver Contrato) e, se `> 0` e marcador
    ausente, retornar `{ status: 'WAITING', nextStepAt: now + delay, variables: { [marker]: until } }`
    com `marker = _msg_delay_until_<node.id>`. Na re-entrada, se `now >= until` → limpar o marcador
    (`{ [marker]: null }`) e seguir para a fase 2. Espelhar `wait.handler.ts` (idempotência por marcador).
  - **Fase 2 (envio):** comportamento atual — pré-ação (`sendPresence` + `ctx.sleep(min(dur,30s))`) e
    `sendMessage`. A pré-ação **permanece** clampada em `PRE_ACTION_MAX_MS`.
  - **Compat runtime:** delay efetivo = `delayMs` se definido; senão, se `preActionDurationMs >
    PRE_ACTION_MAX_MS`, o excedente `(preActionDurationMs - PRE_ACTION_MAX_MS)` vira delay. Assim flows
    legados (88s) passam a esperar ~88s (58s delay não-bloqueante + 30s indicador) sem migração de dados.
  - Exportar `MESSAGE_PRE_ACTION_MAX_MS` (= 30_000) e `MESSAGE_DELAY_MAX_MS` (cap sano, ex.: 24h) para
    reuso/contrato (via `index.ts` se necessário, dentro dos files_allowed).
- Testes (`handlers.test.ts`): 1ª entrada com `delayMs>0` retorna WAITING+marcador; re-entrada vencida
  envia e limpa marcador; `delayMs` ausente + `preActionDurationMs<=30s` mantém 1-fase (sem WAITING);
  compat: `preActionDurationMs=88000` sem `delayMs` → WAITING com `until ≈ now+58s`.

## Fora de escopo

- Inspector / campo na UI (F49-S02).
- Mudança no scheduler ou no flow-worker (o `WAITING` já é tratado pelo dispatcher + scheduler).
- Migração destrutiva do jsonb de `flow_versions` (a compat é em runtime, de propósito).

## Arquivos permitidos

- `packages/flow-engine/src/handlers/message.handler.ts`
- `packages/flow-engine/src/handlers/handlers.test.ts`
- `packages/flow-engine/src/index.ts` (apenas re-export dos novos consts, se preciso)
- `docs/features/FLOW_BUILDER.md` (parágrafo do nó de mensagem: delay vs pré-ação)

## Arquivos proibidos

- `apps/web/**` (F49-S02)
- `packages/flow-engine/src/handlers/wait.handler.ts`, `dispatcher.ts` (sem mudança)
- `apps/workers/**`, `packages/db/**`

## Contratos de entrada/saída

- `node.data.delayMs?: number` (ms, não-bloqueante, sem teto além de `MESSAGE_DELAY_MAX_MS`).
- `node.data.preActionDurationMs?: number` (indicador; runtime clampa em `MESSAGE_PRE_ACTION_MAX_MS`).
- Delay efetivo = `delayMs ?? max(0, preActionDurationMs - MESSAGE_PRE_ACTION_MAX_MS)`.
- Resultado: `WAITING { nextStepAt, variables:{ _msg_delay_until_<id>: number } }` na fase de delay;
  `SUCCESS` após enviar (marcador limpo).

## Definition of Done

- [ ] `delayMs>0` produz UMA fase WAITING (sem `sendMessage`) e a 2ª entrada (vencida) envia exatamente uma vez.
- [ ] Re-entrega RabbitMQ antes do vencimento não duplica envio (marcador idempotente, igual ao `wait`).
- [ ] Sem `delayMs` e `preActionDurationMs<=30s`: continua 1-fase (zero regressão nos flows simples).
- [ ] Compat: legado `preActionDurationMs>30s` espera o total pretendido (delay + indicador), sem migração.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/flow-engine test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas

- O scheduler de flows re-enfileira execuções `waiting` quando `next_step_at` vence — o `WAITING` do nó
  de mensagem reusa esse caminho sem qualquer mudança de infra (idêntico ao `wait`).
- Ordem natural: **delay (não-bloqueante) → pré-ação curta (≤30s) → envio**. O indicador aparece logo
  antes do envio, depois da espera longa.
- Não remover o clamp da pré-ação: o indicador do WhatsApp expira ~25s e sleeps longos bloqueariam o
  prefetch do flow-worker (8). O delay longo DEVE ser `WAITING`, nunca `ctx.sleep`.
