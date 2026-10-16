---
id: F76-S07
title: Personagem nos estados vazios, no recibo de ação com Desfazer e na apresentação do Copiloto
phase: F76
status: blocked
priority: medium
estimated_size: M
model: sonnet
ui: true
depends_on: [F76-S03]
blocks: [F76-S09]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/design/copilot-botao-animacao.md
  - docs/features/ONBOARDING.md
agent_id: frontend-engineer
---
# F76-S07 — Vazios, recibo e onboarding

## Objetivo

O personagem aparece onde dá calor sem custar atenção: pose parada nos vazios de primeiro uso dos objetos
principais, comemoração curta só depois de uma ação que deu certo (com Desfazer), e uma apresentação única do
Copiloto no primeiro uso.

## Contexto

Spec §6.6 (contrato `ActionReceipt` com a F74) e §7. Os vazios hoje usam `EmptyState` (`packages/ui/src/
EmptyState` e `apps/web/shared/components/feedback/EmptyState.tsx`). Tours por membro já existem em
`members.tour_state` (`PUT /api/me/tour-state`).

## Escopo (faz)

- `packages/ui/src/EmptyState/`: prop opcional `mascot?: 'idle' | 'sleep' | 'confused'` que mostra o `Mascot`
  `md` parado acima do título (sem loop, `aria-hidden`); respeita `MascotStage.brandVariant` (`glyph` ⇒ glifo
  parado). Mesma prop no `apps/web/shared/components/feedback/EmptyState.tsx` (delegando).
- Aplicar **só** nos vazios de primeiro uso (lista fechada): `PipelinePage`, `ContactsPage`, `CampaignsPage`,
  `FlowsListPage`, `KnowledgeBasePage`, `AgentsList` (arquivos abaixo). Inbox, listas filtradas sem resultado,
  tabelas de configuração e plataforma: **não**.
- `packages/ui/src/ActionReceipt/`: contrato da spec §6.6 (anel de 30 s do Desfazer com `conic-gradient` animado
  por `@property` ou `stroke-dashoffset`; `celebrate` 24 px só em `done` e só se `MascotStage.claim` concedeu;
  `failed` ⇒ sem personagem, ícone de erro e texto; anúncio `aria-live`).
- `packages/ui/src/MascotPose/` (`<MascotPose state="confused" size={24} />`): pose estática para o card Atenção da
  Loja (F75-S09 consome) e outros usos parados.
- Apresentação do Copiloto: `apps/web/features/copilot/intro/CopilotIntro.tsx` — cartão não modal no primeiro
  uso (personagem `lg` com `play` uma vez, três frases: o que ele faz, "age com as suas permissões", o gesto da
  borda/⌘J), "Entendi" grava `tour_state['copilot-intro']`; exportado para a F74 montar (ela decide onde);
  reduced-motion ⇒ pose estática.
- Testes de componente e histórias Ladle.

## Fora de escopo

- Vazios das telas do Copiloto e da Atividade (F74 usa `EmptyState` com `mascot`). Montagem do intro (F74).

### files_allowed

- `packages/ui/src/EmptyState/**`
- `packages/ui/src/ActionReceipt/**`
- `packages/ui/src/MascotPose/**`
- `apps/web/shared/components/feedback/EmptyState.tsx`
- `apps/web/features/pipeline/board/PipelinePage.tsx`
- `apps/web/features/contacts/ContactsPage.tsx`
- `apps/web/features/campaigns/list/CampaignsPage.tsx`
- `apps/web/features/flow-builder/list/FlowsListPage.tsx`
- `apps/web/features/knowledge/KnowledgeBasePage.tsx`
- `apps/web/features/agents/list/AgentsList.tsx`
- `apps/web/features/copilot/intro/**`
- `packages/ui/src/index.ts`


## Definition of Done

- [ ] vazios de primeiro uso dos 6 objetos com pose parada; nenhum outro `EmptyState` mudou (diff)
- [ ] `ActionReceipt`: comemora só em `done`; Desfazer some após 30 s; teste com relógio falso
- [ ] intro aparece uma vez por membro e nunca para marca `glyph` com personagem (só glifo)
- [ ] axe sem violação séria; capturas 375/1440 × 2 temas × marcas em `apps/web/e2e/.artifacts/f76-s07/`
- [ ] `/hm-designer` aprovado (vazio não pode parecer ilustração de template)

## Validação

```bash
pnpm --filter @hm/ui typecheck
pnpm --filter @hm/web typecheck
pnpm --filter @hm/ui exec vitest run src/EmptyState src/ActionReceipt src/MascotPose --maxWorkers=1
pnpm --filter @hm/web exec vitest run features/copilot/intro --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Em `packages/ui/src/index.ts` só as linhas de export de `ActionReceipt` e
  `MascotPose` (o S03 já fechou antes, por dependência).
