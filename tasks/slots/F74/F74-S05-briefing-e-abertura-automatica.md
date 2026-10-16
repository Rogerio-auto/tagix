---
id: F74-S05
title: Briefing do dia no Copiloto e abertura automática (uma vez por dia, toda vez ou nunca) sem roubar o foco
phase: F74
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F74-S03]
blocks: [F74-S10, F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S05 — Briefing e abertura automática

## Objetivo

Na primeira abertura do dia, o balão aparece sozinho com o Briefing: no máximo 3 itens, por receita em risco, cada um com número, motivo, hora do dado e ação de um clique. Não rouba o foco nem bloqueia a tela. A pessoa escolhe no próprio balão entre abrir toda vez, uma vez por dia ou nunca (A2).

## Escopo (faz)

- `apps/web/features/copilot/briefing/**` (substitui o stub do S03):
  - `BriefingCard.tsx`:
    - cabeçalho "Briefing de quinta, 16 out" (data por `Intl` no fuso do workspace) + "3 itens";
    - cada item: número de ordem em mono, selo de prioridade (texto + cor), título, `small` com o valor em risco e o porquê, e a ação: `ask` envia ao Copiloto; `navigate` vai para a tela;
    - "e mais N itens menores" abre a lista completa na tela cheia;
    - "1 já resolvido" quando o servidor marcar;
    - dado velho: "dados de 06:30" visível;
    - vazio: "Nada pede você agora" + o que mudou desde ontem (link para a Home);
  - `useAutoOpen.ts`: na primeira montagem do shell no dia, lê `me.prefs.auto_open` (padrão do workspace se nulo) e `briefing_last_seen_on`:
    - `daily`: abre se ainda não viu hoje;
    - `always`: abre a cada login (sessão de navegador);
    - `never`: não abre;
    - abre **efêmero** (`ephemeral: true`), sem foco (o foco do teclado fica na página), e anuncia "Briefing do dia disponível no Copiloto; ⌘J para ir até ele";
    - ⌘J leva o foco;
    - marca visto com `markBriefingSeen` quando a pessoa interage ou o balão fica visível por 3 s;
    - não abre se: outro diálogo modal está aberto, o onboarding da F43 está ativo, a rota é `/copiloto`, `available=false` ou a tela é ≤ 767 px (no celular, só o selo de pendência; o S10 decide);
    - espera o shell ficar ocioso (`requestIdleCallback` com teto de 2 s) para não competir com o LCP;
  - `AutoOpenPreference.tsx`: controle no rodapé do balão quando o turno é briefing ("Abrir ao entrar: toda vez · uma vez por dia · nunca"), com `updatePrefs`.
  - Atualiza `pending.briefingItems` no store para a F76 (selo e aceno do mascote).
- `apps/web/e2e/specs/copilot-briefing.spec.ts`: primeira abertura do dia abre efêmero sem foco; clicar fora fecha; recarregar no mesmo dia não abre; `never` não abre; ⌘J foca; ação de item envia a pergunta; dado velho exibido; vazio.

## Fora de escopo

- Geração e score (F73-S12). Preferência no painel de configurações do workspace (`default_auto_open`, S09).

### files_allowed

- `apps/web/features/copilot/briefing/**`
- `apps/web/e2e/specs/copilot-briefing.spec.ts`

### files_forbidden

- `apps/web/features/copilot/core/**`
- `apps/web/features/copilot/conversation/**`

## Definition of Done

- [ ] Fiel à A2 nos dois temas; capturas 1440 em `apps/web/e2e/.artifacts/f74-s05/`
- [ ] Não rouba o foco (e2e confere `document.activeElement` antes e depois); anúncio educado único
- [ ] Não afeta o LCP da Home: medir antes e depois com o build de produção (registrar na nota; regressão > 50 ms reprova)
- [ ] Preferência persiste e é respeitada nos três modos
- [ ] axe sem violação séria; `/hm-designer` contra A2

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/briefing --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/briefing --max-warnings=0
```

## Notas

- Agente: `frontend-engineer`.
- A pergunta 5 da nota de UX (o padrão para papéis de atendimento deveria ser "nunca"?) segue em aberto. O padrão vem do workspace (`default_auto_open`) e pode ser trocado sem código.
