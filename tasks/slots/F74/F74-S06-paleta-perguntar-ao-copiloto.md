---
id: F74-S06
title: Paleta ⌘K com "Perguntar ao Copiloto" quando a busca não acha destino (A6)
phase: F74
status: blocked
priority: medium
estimated_size: S
model: sonnet
ui: true
depends_on: [F74-S01]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S06 — ⌘K pergunta ao Copiloto

## Objetivo

O ⌘K continua sendo navegação. Quando o texto não casa com nenhuma tela, contato ou ação, a primeira linha vira "Perguntar ao Copiloto: <texto>", e Enter leva a pergunta ao balão com o contexto da tela. Com casamento parcial, os destinos vêm primeiro e a pergunta fica logo abaixo, sempre visível (A6).

## Contexto

`apps/web/shared/components/command/CommandPalette.tsx` hoje só navega (destinos de `nav.ts` por papel, F72-S03). O Copiloto entra pela API pública `useCopilot().ask(text, { origin: 'palette' })` do S01.

## Escopo (faz)

- `CommandPalette.tsx`:
  - linha "Perguntar ao Copiloto" com o glifo de órbita estático e o texto digitado;
  - sem destino → é a primeira e fica selecionada; com destinos → vem depois deles;
  - texto com menos de 3 caracteres → não aparece;
  - rodapé de atalhos: "↵ abrir ou perguntar · ⌘J Copiloto";
  - Enter na linha fecha a paleta, chama `ask` (o balão abre com "Vendo: <tela>") e devolve o foco ao compositor do Copiloto;
  - `useCopilot().available = false` → a linha não aparece.
- Uma varredura de texto única quando a busca vira pergunta (o "shimmer" da F76): aqui só a classe e o gancho `data-copilot-question`. A animação é da F76; nada se move sem ela.
- `apps/web/e2e/specs/copilot-palette.spec.ts`: "pipe" acha telas e a pergunta vem abaixo; uma frase sem destino vira a 1ª linha; Enter abre o balão com o chip da tela; papel sem Copiloto não vê a linha.

### files_allowed

- `apps/web/shared/components/command/**`
- `apps/web/e2e/specs/copilot-palette.spec.ts`

### files_forbidden

- `apps/web/shared/components/layout/**`

## Definition of Done

- [ ] Fiel à A6 nos dois temas (capturas 1440 em `apps/web/e2e/.artifacts/f74-s06/`)
- [ ] Teclado: ↑↓, Enter e Esc, com trap de Tab mantido (testes existentes da paleta verdes)
- [ ] axe sem violação séria; `/hm-designer` contra A6

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run shared/components/command --maxWorkers=1
pnpm exec eslint apps/web/shared/components/command --max-warnings=0
```

## Notas

- Agente: `frontend-engineer`. Pequeno: dá para parear com qualquer outro slot de frontend no lote.
