---
id: F58-S10
title: Configurar quando e como enviar sem termos técnicos
phase: F58
status: available
priority: high
estimated_size: M
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/UX_PRINCIPLES.md
---

# F58-S10 — Configurar quando e como enviar sem termos técnicos

## Objetivo

Criar a etapa **Quando enviar**, com agora/agendar, horários permitidos e ritmo
recomendado. Limites técnicos ficam em configurações avançadas e sempre mostram o
efeito em duração e quantidade por dia.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/delivery/**`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/api/**`
- `apps/workers/**`

## Definition of Done

- [ ] Escolha principal é **Enviar agora** ou **Agendar**, com data/hora/timezone claros.
- [ ] Horários oferecem presets legíveis e editor semanal acessível; não usam “send window” na UI.
- [ ] Ritmo padrão recomendado mostra duração estimada, não “rate/min” isolado.
- [ ] Limite diário aparece em avançado e alerta quando o público será dividido em mais de um dia.
- [ ] Resumo reage imediatamente a público, tier, quality e horário selecionado.
- [ ] Mobile, teclado, DST e timezone inválido têm cobertura.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
```

## Notas

- A correção do runtime de agendamento e ritmo pertence ao F58-S11.
