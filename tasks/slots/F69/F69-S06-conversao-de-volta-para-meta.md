---
id: F69-S06
title: Conversão de volta para a Meta — o anúncio aprende com lead qualificado, agendado e fechado
phase: F69
status: available
priority: high
estimated_size: M
depends_on: [F69-S03, F69-S04]
blocks: []
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: backend-engineer

---
# F69-S06 — Conversão de volta para a Meta — o anúncio aprende com lead qualificado, agendado e fechado

## Objetivo

Quando um lead vira qualificado, agendado ou fechado no funil do Leadium, a Meta recebe esse evento e passa a otimizar a campanha para quem fecha — não para quem só preenche formulário.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §6 e `AGENCIA_PLAN` §8 (F67, "send-back de conversão"). O conjunto de dados de destino e a forma de autenticar o envio precisam ser confirmados na documentação da API de Conversões antes de implementar — não assumir.

## Escopo

### files_allowed

- `packages/channels/src/meta/conversions/**`
- `apps/workers/src/conversions-sendback/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/api/src/services/meta/conversions/**`
- `apps/api/src/routes/meta/**`
- `packages/db/src/schema/conversion_sendbacks.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/web/features/meta-connection/**`

### files_forbidden

- `packages/shared/src/consent.ts`

## Escopo (faz)

- Configuração por workspace: qual conjunto de dados, e quais estágios do funil viram quais eventos.
- Evento enviado com o identificador do lead de anúncio quando existir, e dados de contato com hash, nunca em claro.
- Idempotência por evento; retry com recuo; registro do que foi aceito ou recusado.
- Respeito à supressão (F59): contato que revogou não tem evento enviado.

## Fora de escopo

- Pixel no site do cliente.

## Definition of Done

- [ ] Nenhum dado pessoal sai sem hash; teste cobre.
- [ ] Mesmo evento não é contado duas vezes pela Meta (identificador de evento estável).
- [ ] Contato suprimido não gera envio.
- [ ] Falha registrada com motivo e visível na saúde da conexão.
- [ ] Documentação consultada e datada no slot antes de implementar.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o custo por lead FECHADO cai porque a Meta aprendeu quem fecha.
