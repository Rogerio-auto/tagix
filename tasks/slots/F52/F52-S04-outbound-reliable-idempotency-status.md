---
id: F52-S04
title: Outbound confiável — idempotência de envio + race do callback de status
phase: F52
status: done
priority: high
estimated_size: L
depends_on: [F52-S01]
blocks: [F52-S07, F52-S10]
agent_id: backend-engineer
source_docs:
  - docs/features/LIVECHAT.md
completed_at: 2026-06-27T13:09:58Z

---
# F52-S04 — Outbound confiável: idempotência + reconciliação de status

> **Origem:** survey desta sessão. Fragilidades CRÍTICAS do mapeamento outbound: (a) redelivery envia 2×, (b) callback de status chega antes do `externalId` → mensagem presa em `pending` para sempre.

## Objetivo

Garantir que cada mensagem outbound seja enviada **exatamente uma vez** ao provider mesmo sob redelivery de job, e que o status (enviado/entregue/lido/falhou) **sempre** atualize, mesmo quando o callback da Meta chega antes do `externalId` ser persistido.

## Contexto / causa raiz (confirmada)

1. **Sem idempotência** (`apps/workers/src/outbound/db-ports.ts`): se o job é reentregue após crash parcial, `adapter.sendText` roda de novo → 2 wamids, cobrança dupla.
2. **Race do status** (`apps/workers/src/inbound/status.ts:232` + `messages.ts:264`): mensagem nasce com `externalId: null`; o worker só grava o `externalId` após o dispatch. Se o callback de status chega nessa janela, o handler busca por `externalId` e não encontra → status descartado → mensagem fica `pending` (UI "enviando") eternamente.

## Escopo (faz)

- **Idempotência:** gerar/usar `outbound_idempotency_key` (coluna de F52-S01) por job. Antes de chamar o adapter, verificar se a mensagem já tem `externalId` (já enviada) → **não reenviar**, apenas reconciliar status. Passar a chave ao GraphClient quando o provider suportar.
- **Reconciliação de callback tardio:** quando o status handler não encontra a mensagem por `externalId`, **persistir o status pendente** (buffer/tabela leve ou campo) e aplicá-lo assim que o `externalId` for gravado pelo worker outbound — OU inverter para gravar `externalId` de forma que o callback sempre case (avaliar `RETURNING`/persistência antecipada). Resultado obrigatório: status nunca se perde.
- Preservar o **status monotônico** existente (`sent<delivered<read`, `failed` vence) — não regredir.
- Mensagem que falha definitivamente no envio → `viewStatus: failed` + `failedReason` (já existe) emitido no socket.
- Log estruturado das transições e da reconciliação.

## Fora de escopo

- DLX/retry de fila (F52-S03) — aqui é a lógica de idempotência/status, não a malha.
- Lock distribuído / `worker.ts` consumer loop (F52-S10).
- Frontend (F52-S07).
- Coluna nova de schema (já criada em F52-S01).

## Arquivos permitidos

- `apps/api/src/routes/conversations/messages.ts`
- `apps/workers/src/outbound/dispatch.ts`
- `apps/workers/src/outbound/finalize.ts`
- `apps/workers/src/outbound/db-ports.ts`
- `apps/workers/src/inbound/status.ts`

## Arquivos proibidos

- `apps/workers/src/outbound/worker.ts` (F52-S10) · `apps/workers/src/lock.ts` (F52-S10) · `apps/workers/src/inbound/db-ports.ts` (F52-S08) · `apps/web/**`

## Contratos

- `OutboundJob` carrega/deriva `idempotencyKey` estável por mensagem.
- Callback de status para `externalId` ainda não persistido é **reconciliado**, não descartado.

## Definition of Done

- [ ] Teste: reprocessar o mesmo `OutboundJob` (redelivery) **não** chama o adapter 2× (guard "já enviada").
- [ ] Teste: callback de status chega **antes** do `externalId` ser persistido → status é aplicado quando o `externalId` aparece (mensagem sai de `pending`).
- [ ] Teste: ordenação de status fora de ordem (read antes de delivered) continua monotônica.
- [ ] Teste: falha definitiva → `failed` + `failedReason` + socket emitido.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
pnpm --filter @hm/api test
```

## Notas

- A abordagem de reconciliação é mais robusta que tentar fechar a janela de tempo: callbacks da Meta são assíncronos e podem sempre chegar cedo. Tratar "status órfão" como estado de primeira classe.
- Confirmar se o GraphClient/WhatsApp Cloud API aceita header de idempotência; se não, a idempotência é garantida pelo guard local (`externalId` já presente) + unique key.
- Slot grande (L): se passar de ~500 linhas úteis, considerar abrir sub-slot separando idempotência de reconciliação — mas mantê-los juntos é preferível por tocarem os mesmos arquivos.
