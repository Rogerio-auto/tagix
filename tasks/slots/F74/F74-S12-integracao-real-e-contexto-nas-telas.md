---
id: F74-S12
title: Integração real do Copiloto (API e SSE de produção, contexto declarado nas telas, quadro do pipeline anima a execução)
phase: F74
status: blocked
priority: critical
estimated_size: M
model: opus
ui: true
depends_on: [F74-S03, F74-S04, F74-S05, F74-S06, F74-S07, F74-S08, F74-S09, F74-S10, F74-S11, F73-S05, F73-S06, F73-S07, F73-S08, F73-S09, F73-S10, F73-S11, F73-S12, F73-S13, F73-S15]
blocks: [F74-S13]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S12 — Integração real e contexto nas telas

## Objetivo

O Copiloto funciona de ponta a ponta contra a API e o runtime reais, no ambiente de dev:

- as telas principais declaram o que a pessoa está vendo (negócio aberto, contato, conversa, seleção no quadro);
- o SSE atravessa o proxy do Next sem buffer;
- a execução de um lote faz os cards **andarem** no quadro do pipeline, com brilho breve ao pousar (A4: "Executar é visível");
- toda divergência entre o mock e a realidade vira correção, no lado certo.

## Escopo (faz)

- Contexto declarado com `useCopilotPageContext` (S01), uma chamada por tela, sem lógica nova nelas:
  - `apps/web/features/pipeline/board/PipelinePage.tsx`: `view: 'board'`, `filters` do quadro, `selection` quando houver seleção múltipla de cards (se o quadro não tiver seleção múltipla, só `entity` do negócio aberto);
  - `apps/web/features/pipeline/deal/**`: o drawer de negócio declara `entity: { type: 'deal', id }`;
  - `apps/web/features/contacts/ContactDetailDrawer.tsx`: `entity: contact`;
  - `apps/web/app/(app)/conversations/[id]/**`: `entity: conversation` (as sugestões da Inbox, como "Resumir esta conversa", passam a aparecer);
  - Home `/hoje` e `/`: só o fallback de rota.
- Quadro animado: confirmar que `useDealSocket` (`features/pipeline/board/useDealSocket.ts`) move o card ao receber `deal:stage_changed` e que o card pousa com o estado `settled` já existente. Se o quadro **não** rolar até o estágio de destino, adicionar o comportamento (rolagem suave só se o destino estiver fora da vista; reduced motion → sem rolagem animada). Enquanto o Copiloto executa, o balão acoplado fica fora da frente: o cartão de lote recolhe para a barra de progresso.
- Transporte: `NEXT_PUBLIC_COPILOT_TRANSPORT=http` como padrão (remover qualquer resto de mock do caminho de produção); conferir que o proxy do Next não bufferiza o SSE. Se bufferizar, ajustar `apps/web/next.config.mjs` (header `X-Accel-Buffering` e rota sem compressão), com teste de TTFB.
- Encaixe com a F76 (outro trabalho), se os slots dela já tiverem fechado; senão, fica anotado para quem fechar por último:
  - `ActionReceipt` de `@hm/ui` (F76-S07, contrato `<ActionReceipt status message undoUntil onUndo />`) substitui o recibo local do S04, e o local é apagado;
  - `<CopilotPeek active />` (F76-S05) montado na alça do S02;
  - `Thinking` de `@hm/ui` (F76-S03) no indicador "pensando" do S03.
  As pastas da F76 em `apps/web/features/copilot/` (`launcher/`, `attention/`, `intro/`) não são tocadas aqui.
- Divergências do contrato encontradas: correção **no lado certo**. Problema de UI → arquivo da F74 com nota de correção. Problema de API → nota em `tasks/COMMS.md` para o slot dono da F73, sem editar a API aqui.
- Roteiro manual ponta a ponta no dev, registrado na nota com tempos reais (TTFB e `final`) e o modelo usado: as perguntas e ações das telas A2–A11, com 3 papéis (OWNER, SUPERVISOR, AGENT) e uma empresa em só leitura.

### files_allowed

- `apps/web/features/pipeline/board/PipelinePage.tsx`
- `apps/web/features/pipeline/board/useDealSocket.ts`
- `apps/web/features/pipeline/board/StageColumn.tsx`
- `apps/web/features/pipeline/deal/**`
- `apps/web/features/contacts/ContactDetailDrawer.tsx`
- `apps/web/app/(app)/conversations/[id]/**`
- `apps/web/features/copilot/core/**`
- `apps/web/features/copilot/surfaces/**`
- `apps/web/features/copilot/handle/**`
- `apps/web/features/copilot/conversation/**`
- `apps/web/features/copilot/cards/**`
- `apps/web/features/copilot/actions/**`
- `apps/web/features/copilot/briefing/**`
- `apps/web/features/copilot/fullscreen/**`
- `apps/web/features/copilot/activity/**`
- `apps/web/features/copilot/memory/**`
- `apps/web/features/copilot/settings/**`
- `apps/web/features/copilot/mobile/**`
- `apps/web/features/copilot/autopilot/**`
- `apps/web/features/copilot/index.ts`
- `apps/web/next.config.mjs`
- `.env.example`

### files_forbidden

- `apps/api/**`
- `apps/agent-runtime/**`
- `packages/**`

## Definition of Done

- [ ] Roteiro ponta a ponta (dev, API e runtime reais) registrado na nota, com TTFB p95 ≤ 800 ms e `final` p50 ≤ 4 s medidos em 20 perguntas
- [ ] O fluxo da A4 real: 7 negócios, conflito em 2, cards andando no quadro, "5 de 7" e desfazer
- [ ] Contexto: abrir um negócio e perguntar "por que esse esfriou?" responde sobre **esse** negócio (chip correto)
- [ ] Só leitura: perguntas funcionam e escrita mostra o bloqueio de assinatura; view-as: o Copiloto some
- [ ] Testes existentes de `features/pipeline`, `features/contacts` e `conversations` verdes
- [ ] Capturas 1440 e 375 nos dois temas dos fluxos reais em `apps/web/e2e/.artifacts/f74-s12/`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot features/pipeline features/contacts --maxWorkers=1
pnpm exec eslint apps/web/features/copilot apps/web/features/pipeline apps/web/features/contacts --max-warnings=0
pnpm --filter @hm/web build
```

## Notas

- Agente: `frontend-engineer` (opus). Precisa da infra de dev de pé (`docker compose … up -d`), da API, dos workers e do runtime.
- Sozinho no lote: mexe em telas compartilhadas (pipeline, contatos, conversas).
