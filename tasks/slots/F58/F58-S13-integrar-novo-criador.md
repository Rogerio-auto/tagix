---
id: F58-S13
title: Integrar o novo criador e revisar antes de iniciar
phase: F58
status: available
priority: critical
estimated_size: L
depends_on: [F58-S07, F58-S08, F58-S09, F58-S10, F58-S12]
blocks: [F58-S14]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
---

# F58-S13 — Integrar o novo criador e revisar antes de iniciar

## Objetivo

Substituir o wizard técnico atual pelo fluxo guiado de cinco etapas e entregar uma
revisão final que responda, em linguagem direta: quem recebe, qual mensagem, quando
começa, quanto tempo leva e o que ainda impede o envio.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/web/features/campaigns/editor/queries.ts`
- `apps/web/features/campaigns/editor/types.ts`
- `apps/web/features/campaigns/editor/hydrate.ts`
- `apps/web/features/campaigns/editor/hydrate.test.ts`
- `apps/web/features/campaigns/editor/review/**`
- `apps/web/app/(app)/campaigns/new/**`
- `apps/web/app/(app)/campaigns/[id]/edit/**`

### files_forbidden

- `apps/api/**`
- `apps/workers/**`

## Definition of Done

- [ ] Fluxo final tem: **Começar**, **Público**, **Mensagem**, **Quando enviar**, **Revisar e iniciar**.
- [ ] Progresso mostra nomes das etapas, concluído/erro e permite voltar sem perder dados.
- [ ] Validação relevante acontece na própria etapa; revisão não surpreende com erro descoberto tarde.
- [ ] Revisão mostra contagem final, consentimento, modelo/preview, variáveis, início, duração, limite diário, quality/tier traduzidos e avisos.
- [ ] Ativação exige preflight fresco e confirmação explícita com número de destinatários.
- [ ] Depois de ativar, usuário vai para monitoramento e vê o primeiro tick/status sem ambiguidade.
- [ ] Edição de rascunho hidrata tudo; campanha ativa permanece somente leitura com ações seguras.
- [ ] Campo manual de nome de template e termos Broadcast/Drip/Triggered/Rate/Tier foram removidos da jornada principal.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm --filter @hm/web build
pnpm lint
```

## Notas

- Preservar compatibilidade de leitura com campanhas antigas; migração de dados de UI deve ser tolerante.
