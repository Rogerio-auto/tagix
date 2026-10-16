---
id: F74-S02
title: Superfícies do Copiloto (balão, painel acoplado, troca FLIP, atalho ⌘J) e alça de borda com gesto (A1)
phase: F74
status: blocked
priority: critical
estimated_size: L
model: opus
ui: true
depends_on: [F74-S01]
blocks: [F74-S03, F74-S10]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
agent_id: frontend-engineer
---
# F74-S02 — Superfícies e alça de borda

## Objetivo

O Copiloto aparece em qualquer tela do app, do jeito da maquete. A alça fina na borda direita se arrasta para abrir. Clique, Enter e ⌘J/Ctrl+J abrem o mesmo balão. O balão (412 px) vira painel acoplado (420 px, empurrando o conteúdo) sem perder nada, numa transição FLIP de 400 ms. É um diálogo **não modal**, acessível de verdade.

## Contexto

Maquete A1 (4 estados da alça) e as regras de gesto, tamanhos e acessibilidade da nota de UX §3. O conteúdo (conversa) é do S03: aqui a superfície renderiza `<CopilotConversation/>` de `features/copilot/conversation`, que este slot cria como **stub** (painel vazio com o compositor desabilitado), e o S03 substitui. O botão da sidebar e do TopBar e o mascote são da F76.

## Escopo (faz)

- `apps/web/features/copilot/surfaces/**`:
  - `CopilotRoot.tsx`: substitui o stub do S01 e escolhe a superfície pelo `size` do store;
  - `Bubble.tsx` (412 px, ancorado à direita, vidro discreto `--surface-glass`; com `prefers-reduced-transparency`, sólido);
  - `DockedPanel.tsx` (420 px, empurra o conteúdo);
  - cabeçalho comum: glifo de órbita estático, chip de contexto (S01), botões de tamanho (balão, acoplado, tela cheia → navega para `/copiloto` levando a sessão) e ×;
  - rodapé fixo "Age com as suas permissões: <papel>" (rótulo do papel em pt-BR).
- Transições: troca entre balão e acoplado por **FLIP de 400 ms** (`--ease-mover` do DS 3.0), só `transform` e `opacity`. Abrir por gesto tem mola curta (bounce ~0,15); abrir por clique ou teclado, esmaecimento e escala de 160 ms. Com `prefers-reduced-motion`, tudo vira esmaecimento de 160 ms.
- Comportamento:
  - não modal: a página atrás segue clicável;
  - balão aberto **sozinho** (`ephemeral`, briefing) fecha ao clicar fora; aberto pela pessoa, fica até ela fechar;
  - Esc fecha e devolve o foco a quem abriu;
  - ⌘J/Ctrl+J abre, foca o compositor e alterna; usar o sistema de atalhos existente (o mesmo do `SettingsSearch`) e registrar o atalho na seção "Atalhos" das configurações, se ela listar atalhos de um registro;
  - o acoplado empurra o conteúdo: `apps/web/shared/components/layout/AppLayout.tsx` ganha uma variável CSS (`--copilot-docked-width`) aplicada ao conteúdo principal quando o store diz `docked`, sem reflow do shell inteiro;
  - a preferência de tamanho é persistida em `copilot_member_prefs.surface` via `useCopilot` (S01).
- Acessibilidade: `role="dialog"` + `aria-modal="false"` + `aria-label="Copiloto"`; região `aria-live="polite"` (anuncia o veredito ao terminar, entregue pelo S03; aqui só a região); foco visível pelo anel do DS (`focus-ring`); armadilha de foco **não** (não modal), mas Tab circula dentro do painel até sair por Esc ou Shift+Tab no primeiro elemento.
- `apps/web/features/copilot/handle/**`, a alça de borda (A1):
  - repouso: pílula de 5 × 58 px a meia altura da borda direita, halo tênue, zona de pega de 30 × 120 px, sem cobrir conteúdo;
  - hover e foco: a aba "Copiloto ⌘J" desliza em 200 ms;
  - é um `<button>` (Enter abre) com `aria-keyshortcuts="Meta+J Control+J"`;
  - arrasto por Pointer Events: só captura com |dx| > |dy| e dx > 6 px; anel de progresso até **80 px**; depois do limiar, o texto vira "Solte para abrir", o anel ganha `--brand-text` e o arrasto ganha resistência (rubber-band); soltar depois do limiar abre com mola; antes, volta com a mesma mola; `touch-action: pan-y` para não brigar com a rolagem;
  - fechar arrastando o balão de volta para a borda (> 90 px);
  - some quando o Copiloto está aberto, `available=false` ou a tela é ≤ 767 px (o celular é do S10);
  - primeiro uso: a aba aparece 3 s com a dica, uma vez só (`first_use_hint_seen_at`);
  - ponto de montagem para `<CopilotPeek active />` da F76-S05 (o personagem espiando na alça). Se a F76 ainda não existir, deixe o slot vazio com comentário; a F74-S12 integra.
- `apps/web/features/copilot/conversation/index.ts`: **stub** de `CopilotConversation`, que o S03 substitui.
- Spec e2e `apps/web/e2e/specs/copilot-shell.spec.ts` (usa o `copilot-mock` do S01): abrir por clique, Enter, ⌘J e arrasto (simulado com `page.mouse`); soltar antes do limiar não abre; Esc devolve o foco; balão ↔ acoplado sem perder o estado; o acoplado empurra o conteúdo; clique fora fecha só o efêmero.

## Fora de escopo

- Conversa (S03), celular (S10), tela cheia (S07), botão e mascote (F76).

### files_allowed

- `apps/web/features/copilot/surfaces/**`
- `apps/web/features/copilot/handle/**`
- `apps/web/features/copilot/conversation/index.ts`
- `apps/web/shared/components/layout/AppLayout.tsx`
- `apps/web/e2e/specs/copilot-shell.spec.ts`

### files_forbidden

- `apps/web/shared/components/layout/Sidebar.tsx`, `apps/web/shared/components/layout/TopBar.tsx` (F76)
- `apps/web/features/copilot/core/**` (S01; consumir pela API pública)

## Definition of Done

- [ ] Os 4 estados da alça fiéis à A1, nos dois temas
- [ ] Gesto: limiar de 80 px, resistência, mola, sem conflito com rolagem vertical (e2e com scroll na lista do pipeline)
- [ ] FLIP de 400 ms entre balão e acoplado sem perder conversa nem rolagem; reduced motion → esmaecimento de 160 ms (e2e verifica `transition-property`)
- [ ] Acessibilidade: axe sem violação séria; foco volta a quem abriu; `aria-keyshortcuts`; anel de foco ≥ 3:1 nos dois temas
- [ ] Capturas 1440 nos dois temas, nos estados repouso, hover, arrastando, aberto (balão) e acoplado, em `apps/web/e2e/.artifacts/f74-s02/`
- [ ] INP do arrasto: nenhum quadro longo > 50 ms com CPU 4× mais lenta (registro do Performance panel ou LoAF na nota)
- [ ] `/hm-designer` contra A1, A3 (moldura) e A4 (acoplado); "parece template" reprova

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/surfaces features/copilot/handle --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/surfaces apps/web/features/copilot/handle --max-warnings=0
```

## Notas

- Agente: `frontend-engineer` (opus: gosto e movimento). Antes de codar, leia `docs/design/copilot-integracoes.html` (`?solo=A1`, `?solo=A4`) e o cânone de movimento (`~/.claude/skills/canone`).
- Verde-neon só na ação primária da tela. O Copiloto não usa roxo, faísca nem bolha de chat.
- Rodar o e2e com `--workers=1` e registrar o resultado na nota.
