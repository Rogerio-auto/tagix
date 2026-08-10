---
id: F58-S06
title: Preparar opções, prévias e teste do novo criador
phase: F58
status: available
priority: critical
estimated_size: M
depends_on: [F58-S01, F58-S04, F57-S01]
blocks: [F58-S07, F58-S08, F58-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/features/PERMISSIONS.md
---

# F58-S06 — Preparar opções, prévias e teste do novo criador

## Objetivo

Fornecer ao frontend um contrato único com canais elegíveis, modelos aprovados,
estimativa de público/duração e envio de teste, evitando que o wizard monte regras
de negócio por conta própria.

## Escopo

### files_allowed

- `apps/api/src/routes/campaigns/builder/**`
- `apps/api/src/routes/campaigns/index.ts`
- `apps/api/src/routes/campaigns/validate.ts`
- `apps/api/src/routes/campaigns/service.ts`
- `apps/api/src/routes/campaigns/builder*.test.ts`

### files_forbidden

- `apps/web/**`
- `apps/workers/**`

## Definition of Done

- [ ] Endpoint de opções retorna apenas canais ativos e informa capacidades por provider.
- [ ] Para este fluxo, apenas WhatsApp oficial com credencial válida permite modelos HSM.
- [ ] Modos públicos são `single` e `sequence`, mapeados internamente para `broadcast` e `drip`; `triggered` é recusado com explicação.
- [ ] Estimativa retorna público válido, sem consentimento, duplicados, limite diário, tier e duração aproximada.
- [ ] Envio de teste usa o pipeline outbound real, destinatário explícito e idempotência; nunca entra nas métricas da campanha.
- [ ] Preflight bloqueia canal inativo, template não aprovado, quality/tier desconhecido em disparo grande e variáveis sem valor.
- [ ] Contratos Zod e testes de permissão/isolamento cobrem todos os endpoints.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
```

## Notas

- Mensagens de erro da API devem ser prontas para exibição, com código estável e orientação curta.
