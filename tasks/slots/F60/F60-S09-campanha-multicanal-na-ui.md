---
id: F60-S09
title: Campanha multicanal na interface — passos por capacidade, público e métrica por canal
phase: F60
status: available
priority: high
estimated_size: M
depends_on: [F60-S07, F58-S12]
blocks: []
agent_id: frontend-engineer

---
# F60-S09 — Campanha multicanal na interface — passos por capacidade, público e métrica por canal

## Objetivo

Levar para a tela o que a F60-S07 entregou no backend: o criador de campanha monta os passos pela capacidade do canal, estima o público por canal e mostra a métrica que o canal tem.

## Contexto

Absorve os três itens que a F60-S07 declarou como "fica para o slot seguinte" sem que o slot tivesse sido criado (auditoria de 2026-09-14). Hoje e-mail é elegível na API, mas a interface continua moldada ao WhatsApp.

## Escopo

### files_allowed

- `apps/web/features/campaigns/**`
- `apps/api/src/routes/campaigns/builder/**`
- `apps/api/src/routes/campaigns/*.test.ts`

### files_forbidden

- `apps/workers/src/outbound/**`

## Escopo (faz)

- Passos montados a partir de `capabilities` (exige modelo? tem assunto? limite de caracteres?), sem `if` por canal.
- Estimativa exclui quem não tem o identificador do canal (sem e-mail não entra em campanha de e-mail).
- Métrica por canal: abertura e clique em e-mail; leitura em WhatsApp.

## Fora de escopo

- Adapter de SMS.

## Definition of Done

- [ ] Nenhum `if (provider === ...)` novo na interface do criador.
- [ ] Estimativa de público por canal testada.
- [ ] Métrica exibida só onde o canal a tem.
- [ ] Campanha de WhatsApp continua idêntica — teste de regressão.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm --filter @hm/api test
```

## Notas

- A régua: criar campanha de e-mail não passa por nenhuma tela que fale de modelo do WhatsApp.
