---
id: F58-S08
title: Facilitar a escolha dos destinatários
phase: F58
status: available
priority: high
estimated_size: M
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: fullstack-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/features/PERMISSIONS.md
  - docs/UX_PRINCIPLES.md
---

# F58-S08 — Facilitar a escolha dos destinatários

## Objetivo

Substituir a caixa de texto CSV por uma importação guiada, com prévia honesta do
público e consentimento explícito antes de qualquer ativação.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/audience/**`
- `apps/api/src/routes/campaigns/recipients.ts`
- `apps/api/src/routes/campaigns/recipients.test.ts`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/workers/**`

## Definition of Done

- [ ] Upload aceita arquivo CSV e mantém colar dados como alternativa; parser trata aspas, vírgulas e cabeçalhos.
- [ ] Mapeamento de telefone/nome/consentimento é mostrado antes da importação.
- [ ] Prévia separa válidos, inválidos, duplicados, já existentes e sem consentimento.
- [ ] Registro de consentimento exige origem legível; não existe checkbox ambíguo “dar opt-in”.
- [ ] API processa 1.000+ linhas em lote, sem SELECT/INSERT por linha, e devolve relatório paginável.
- [ ] Reimportação é idempotente e nunca remove destinatários silenciosamente.
- [ ] Testes cobrem 1.001 linhas, duplicados, CSV citado, E.164 e isolamento RLS.

## Validação

```bash
pnpm --filter @hm/api test -- src/routes/campaigns/recipients.test.ts
pnpm --filter @hm/web test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
```

## Notas

- Segmentação salva fica fora deste slot; o empty state pode anunciá-la como evolução futura sem CTA morto.
