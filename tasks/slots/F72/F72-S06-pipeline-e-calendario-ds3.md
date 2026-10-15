---
id: F72-S06
title: Pipeline e calendário unificado no DS 3.0
phase: F72
status: in-progress
priority: high
estimated_size: M
ui: true
depends_on: [F72-S02, F72-S03]
blocks: [F72-S09]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-15T03:17:37Z

---
# F72-S06 — Pipeline e calendário no DS 3.0

## Objetivo

O funil (kanban, card do deal, valores) e a agenda (o calendário unificado e a agenda do cockpit) seguem os padrões "Pipeline" e "Unified calendar" da maquete.

## Escopo (faz)

- Pipeline:
  - colunas, card (valor em mono e tempo na etapa), drag com feedback em menos de 200ms (§05), soltar com State morph;
  - configurações do pipeline.
- Calendário: dia, semana e lista; eventos por tipo com cor de token; "agora" como único movimento contínuo; mobile na aba Agenda.
- Agenda do cockpit (`features/cockpit-agenda`) coerente com o calendário.

### files_allowed

- `apps/web/features/pipeline/**`, `apps/web/app/(app)/pipeline/**`
- `apps/web/features/calendar/**`, `apps/web/app/(app)/calendar/**`
- `apps/web/features/cockpit-agenda/**`
- `apps/web/e2e/specs/pipeline*.spec.ts`, `apps/web/e2e/specs/calendar*.spec.ts`

## Definition of Done

- [ ] fiel aos padrões da maquete nos dois temas, 375/1440
- [ ] drag do pipeline acessível por teclado (ou alternativa equivalente), testado
- [ ] e2e de pipeline e calendário verdes
- [ ] axe sem violação séria; revisão `/hm-designer`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/pipeline features/calendar features/cockpit-agenda --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
