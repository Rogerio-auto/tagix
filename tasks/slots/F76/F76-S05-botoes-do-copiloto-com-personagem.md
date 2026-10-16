---
id: F76-S05
title: Botões do Copiloto na sidebar, TopBar, barra recolhida e celular, com varredura, personagem e alça espiando
phase: F76
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F76-S03, F76-S04, F74-S01]
blocks: [F76-S08, F76-S09]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/design/copilot-botao-animacao.md
  - docs/design/copilot-botao-animacao.html
  - docs/design/copilot-integracoes-ux.md
agent_id: frontend-engineer
---
# F76-S05 — Launcher do Copiloto

## Objetivo

O Copiloto tem uma porta de entrada viva e discreta: na sidebar, "Copiloto" com o personagem de 24 px e uma linha
de status que diz o motivo; no TopBar, o atalho compacto; recolhida, só o personagem; no celular, 44 × 44 no
TopBar. As letras ganham uma varredura de vez em quando e o personagem acena ou brinca quando o orçamento de
atenção deixa. Um ator por vez.

## Contexto

Spec §6.5 (contrato com a F74), demo seções "Botões", "Letras", "Alça", capturas `botoes-*`, `letras-*`,
`alca-*`, `celular-375-*`. A F74-S01 entrega o núcleo do Copiloto e a **única** porta pública `useCopilot()` (de
`apps/web/features/copilot`): `available`, `open`, `close`, `toggle`, `isOpen`, `status`
(`idle|thinking|reading|acting|error`), `pending` (`briefingItems`, `suggestions`, `approvals`) e `lastOutcome`
(`action_done|action_failed|null`). A F74 deixa explicitamente para a F76 o botão na sidebar e no TopBar
(`shared/components/layout/{Sidebar,TopBar}.tsx`); a alça de borda é da F74-S02 (`features/copilot/handle/**`).

## Escopo (faz)

- `apps/web/features/copilot/launcher/`:
  - `CopilotLauncher` (`variant: 'sidebar'|'topbar'|'rail'|'mobile'`) com as medidas da spec §6.5; estados hover
    (200 ms `--ease-saida`, `--surface-2`, uma varredura por entrada do cursor no máx. 1 a cada 2 s, personagem
    `look='up'`), foco (anel 2 px offset 2 px, teclado não dispara animação), pressionado (`scale(.97)` 120 ms),
    aberto (barra 2 px `--m-accent`, `look` para o painel, atalho vira Esc, `aria-expanded`), pendência (ponta da
    antena acesa em `--m-accent` ou `--warn`, sem ponto separado);
  - "Copiloto" em `GradientText`; linha de status (`statusLine` do diretor: "3 itens no briefing", "Vértice com
    falha") truncada com reticências e completa no `title`/`aria-describedby`;
  - liga `useAttentionDirector` (S04) ao `Mascot` (S03) via `MascotStage.claim`; **sidebar chama, TopBar só ganha
    vida quando a sidebar não está visível** (media query + estado recolhido);
  - `CopilotPeek`: o personagem espiando na alça de borda (estado `peek`) exportado para a F74 montar na alça
    dela (contrato: `<CopilotPeek active={boolean} />`, posicionado pela alça, `clip-path`, sem layout shift);
  - atalho ⌘J/Ctrl+J exibido no `kbd` (a F74 registra o atalho);
  - mapeamento `useCopilot()` ⇒ personagem: `status` `thinking|reading|acting` ⇒ `thinking`; `lastOutcome`
    `action_done` ⇒ `celebrate` (não gasta cota), `action_failed` ⇒ `confused` só se resolvível; `pending` ⇒
    `statusLine` e `notify({ kind: 'briefing'|'suggestion' })` do diretor (S04); `isOpen` ⇒ estado aberto e
    `markOpened()`;
  - montagem: `<CopilotLauncher variant="sidebar"|"rail" />` em `Sidebar.tsx` e `variant="topbar"|"mobile"` em
    `TopBar.tsx` (mudança mínima: importar e posicionar), escondido quando `useCopilot().available` é falso.
- Gatilhos por evento: briefing pronto ⇒ `notify({ kind: 'briefing' })` (derivado de `pending.briefingItems`); erro de integração ⇒ a
  F75 (alertas) chama `notify({ kind: 'integration_error', key: connectionId })` — este slot expõe e documenta;
  primeiro uso ⇒ `play` (1×/semana).
- Celular 375: 44 × 44, personagem 24 px, sem texto, varredura desligada (texto não aparece), alvo ≥ 44 px.
- Pausa com aba oculta e fora da viewport; zero CLS (largura reservada); SSR pinta a pose estática.
- Testes de componente (estados, um ator por vez sidebar × TopBar, teclado não anima) e e2e
  `apps/web/e2e/specs/copilot-launcher.spec.ts` (relógio falso do Playwright para o orçamento).

## Fora de escopo

- Painel, alça e gesto do Copiloto (F74). Orçamento (S04). Telemetria (S08).

### files_allowed

- `apps/web/features/copilot/launcher/**`
- `apps/web/shared/components/layout/Sidebar.tsx`
- `apps/web/shared/components/layout/TopBar.tsx`
- `apps/web/e2e/specs/copilot-launcher.spec.ts`

### files_forbidden

- `apps/web/features/copilot/core/**`, `apps/web/features/copilot/index.ts`, `apps/web/features/copilot/handle/**`,
  `apps/web/features/copilot/surfaces/**` (F74)

## Definition of Done

- [ ] fiel ao demo (direção C) nas 4 variantes, dois temas, 1440 e 375, comparando com as capturas
- [ ] e2e: com o relógio falso, aceno só depois de 3 min, 20 s parado e 4 s sem tecla; nunca com modal aberto
- [ ] sidebar e TopBar nunca animam ao mesmo tempo (teste)
- [ ] reduced-motion: pose estática, varredura vira troca de cor de 200 ms
- [ ] CLS 0 no carregamento do shell; INP p75 ≤ 200 ms com CPU 4× (registrar)
- [ ] axe sem violação séria; capturas em `apps/web/e2e/.artifacts/f76-s05/`
- [ ] `review-animations` + `/hm-designer` aprovados

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm exec eslint apps/web/features/copilot/launcher
pnpm --filter @hm/web exec vitest run features/copilot/launcher --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Dependência real da F74-S01: `useCopilot()`. O `CopilotPeek` é exportado para a
  F74-S02 montar na alça (contrato `<CopilotPeek active />`); se a F74-S02 fechar antes, ela integra depois por
  `tasks/COMMS.md`. `Sidebar.tsx`/`TopBar.tsx` são da F72 (done) e disputados: mudança mínima.
