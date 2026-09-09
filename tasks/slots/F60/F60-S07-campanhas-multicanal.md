---
id: F60-S07
title: Campanhas para os outros canais
phase: F60
status: blocked
priority: critical
estimated_size: L
depends_on: [F60-S03]
blocks: []
source_docs:
  - docs/features/CANAIS_PLAN.md
  - docs/features/CAMPAIGNS.md
---

# F60-S07 — Campanhas para os outros canais

## Objetivo

Permitir criar campanha em qualquer canal disponível — e-mail, Instagram, SMS quando existir — e não
só WhatsApp, com conteúdo, público e métrica declarados **por canal**.

## Contexto

Pedido direto do Rogério (2026-09-09): "nas tarefas de campanhas tem que ser possível criar campanhas
para os outros canais". O criador nasceu WhatsApp-cêntrico e a F58 reforçou isso — o fluxo guiado
gira em torno de modelo HSM aprovado pela Meta, conceito que só existe no WhatsApp oficial.
Desenho em `CANAIS_PLAN` §12.

## Escopo

### files_allowed

- `apps/api/src/routes/campaigns/builder/**`
- `apps/api/src/routes/campaigns/validate.ts`
- `apps/api/src/routes/campaigns/service.ts`
- `apps/api/src/routes/campaigns/*.test.ts`
- `packages/db/src/schema/campaigns.ts`
- `packages/db/drizzle/0075_f60_campaign_channel_content.sql`
- `packages/db/drizzle/meta/**`
- `apps/workers/src/campaigns/steps/**`
- `apps/workers/src/campaigns/*.test.ts`
- `apps/web/features/campaigns/**`

### files_forbidden

- `apps/workers/src/outbound/**`
- `packages/shared/src/consent.ts`

## Escopo (faz)

- **Conteúdo por canal**, não conteúdo único traduzido: e-mail tem assunto e corpo HTML; SMS tem
  texto com segmentação; WhatsApp tem modelo aprovado; Instagram não tem modelo nenhum.
- **Elegibilidade vem da capacidade do adapter** (F60-S01), não de `if` por canal. O wizard monta os
  passos perguntando ao adapter: exige modelo aprovado? tem assunto? tem limite de caracteres?
- **Público por canal**: contato com e-mail e sem telefone é elegível para e-mail e não para SMS. A
  estimativa precisa refletir isso.
- **Métrica por canal**: abertura e clique existem em e-mail e não em WhatsApp; leitura existe em
  WhatsApp e não em e-mail.

## Fora de escopo

- Adapter de SMS (F60-S06) — quando existir, entra por capacidade, sem mudar este código.
- O portão de consentimento: **já funciona para todos os canais** desde a F59-S05.

## Definition of Done

- [ ] Criar campanha de e-mail ponta a ponta: público, conteúdo, agendamento, envio, métrica.
- [ ] Campanha de WhatsApp continua funcionando **exatamente** como hoje — teste de regressão do fluxo F58.
- [ ] Estimativa de público exclui quem não tem o identificador do canal, e o número exibido bate com o entregue.
- [ ] O wizard não oferece passo que o canal não suporta (nada de "escolher modelo" em e-mail).
- [ ] Relatório não inventa métrica que o canal não tem — ausência é exibida como ausência, não como zero.
- [ ] O portão da F59 recusa por canal e a recusa aparece no relatório da campanha com o motivo.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- Exibir zero onde a métrica não existe é pior que exibir nada: o cliente conclui que a campanha não
  funcionou.
- Regressão do fluxo WhatsApp é obrigatória antes do `finish` — é o que está em produção hoje.
