---
id: F58-S15
title: Fechar as pontas da entrega confiável — opt-out no envio, botão com variável, contagem na pausa e contrato único
phase: F58
status: available
priority: critical
estimated_size: M
depends_on: [F58-S12]
blocks: [F58-S14]
agent_id: backend-engineer
source_docs:
  - tasks/slots/F58/F58-S12-entrega-campanha-confiavel.md
  - docs/features/CAMPAIGNS.md

---
# F58-S15 — Fechar as pontas da entrega confiável

## Objetivo

Os três itens do DoD da F58-S12 que dependiam de arquivos fora da fronteira dela: botão com
variável chega à Meta, pausar/cancelar diz quantas mensagens segurou, e o contrato
`binding_contract/v1` passa a existir num lugar só.

## Contexto

Registrado em 2026-10-07 ao integrar a F58-S12 (commit de implementação na main: "nenhuma mensagem
da campanha se perde nem sai de campanha parada"):

1. `sub_type`/`index` já chegam ao `SendTemplateInput` do adapter, mas
   `packages/channels/src/meta/whatsapp/serializer.ts` (`serializeTemplateComponent`) copia só
   `type` e `parameters` → a Meta recusa botão com variável no link. A F58-S09 bloqueia o teste
   desse caso na tela até aqui.
2. O trigger `campaign_outbox_gate` (migration 0095) grava em `audit_logs` a ação
   `campaign.outbox_gated` com `{transition, held|released|dropped, inFlight}` na mesma transação
   da mudança de status, mas a resposta HTTP de pausar/retomar/cancelar não devolve esses números.
3. `binding_contract/v1` está definido duas vezes (API e workers). O teste dos workers trava o
   formato, mas a fonte tem de ser uma.
4. **Opt-out entre o disparo e o envio não é respeitado.** O job de campanha não leva
   `purpose: 'marketing'`, então o outbound não reconfere consentimento no envio. Com a retenção na
   pausa (0095), um job pode sair horas depois do disparo. Marcar `marketing` sem mais nada faz o
   horário de silêncio do outbound FALHAR a mensagem em vez de adiar. Decisão (2026-10-07): o envio
   de campanha reconfere o consentimento e **adia** quando cai no horário de silêncio; opt-out/supressão
   **descarta** com `failed` e motivo legível.

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/serializer.ts`
- `packages/channels/src/meta/whatsapp/*.test.ts`
- `apps/api/src/routes/campaigns/lifecycle.ts`
- `apps/api/src/routes/campaigns/crud.ts`
- `apps/api/src/routes/campaigns/**/*.test.ts`
- `packages/shared/src/campaigns/**`
- `packages/shared/src/index.ts` *(só para expor o leaf, se necessário — preferir import pelo leaf)*
- `apps/workers/src/campaigns/outbox/bindings.ts`
- `apps/workers/src/campaigns/outbox/*.test.ts`
- `apps/workers/src/outbound/consent-gate.ts`
- `apps/workers/src/outbound/job.ts`
- `apps/workers/src/outbound/**/*.test.ts`
- `apps/workers/src/campaigns/db-ports.ts` *(marcar o propósito do job)*
- arquivos da API que hoje definem o contrato `binding_contract/v1` (localizar e listar no `.md` antes de mexer)

### files_forbidden

- `packages/db/**` (sem migration)
- `apps/web/**`

## Definition of Done

- [ ] `serializeTemplateComponent` envia `sub_type` e `index` do botão; teste com botão de URL com
      variável no formato que a Cloud API exige.
- [ ] Pausar, retomar e cancelar devolvem `{ held | released | dropped, inFlight }` lidos da mesma
      transação; teste de rota para cada um.
- [ ] `binding_contract/v1` vive em `@hm/shared` (leaf), API e workers importam de lá; o teste que
      trava o formato continua passando.
- [ ] Job de campanha reconfere consentimento no envio: contato que fez opt-out depois do disparo
      não recebe (delivery `failed` com motivo); horário de silêncio adia sem gastar tentativa. Teste
      com opt-out entre o disparo e a retomada de uma campanha pausada.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/channels test
pnpm --filter @hm/api exec vitest run src/routes/campaigns
pnpm --filter @hm/workers exec vitest run src/campaigns
```
