---
id: F76-S01
title: Spike medido — SVG+CSS com máquina de estados em TS contra Rive para o personagem
phase: F76
status: available
priority: critical
estimated_size: M
model: opus
ui: true
depends_on: []
blocks: [F76-S02]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/design/copilot-botao-animacao.md
  - docs/design/copilot-botao-animacao.html
agent_id: frontend-engineer
---
# F76-S01 — Spike de tecnologia (medido)

## Objetivo

A tecnologia do personagem é escolhida por número, não por gosto: duas implementações do mesmo rig C (S: SVG
inline + CSS/WAAPI + máquina de estados em TS; R: Rive) medidas nos 7 critérios do ADR-006 §2, com CPU 4× mais
lenta, e a decisão anotada no ADR-006 §8.

## Contexto

A direção C foi escolhida (16/10). A proposta deu 17/30 à C porque "pede Rive, runtime pesado" e porque "os braços
viram ruído a 24 px". Este slot resolve o primeiro ponto com medida; o segundo é da arte (S02), mas o spike já usa
o LOD `sm` sem braços em repouso para medir o caso real do botão.

## Escopo (faz)

- Harness isolado em `docs/design/mascote-spike/` (fora do workspace pnpm; `package.json` próprio, instalado com
  `npm ci` dentro da pasta, sem tocar no lockfile do monorepo):
  - `s/`: rig C do demo (`copilot-botao-animacao.html`, `[data-d='C']`) extraído para SVG inline + CSS +
    `machine.ts` (estados idle, blink, wave, thinking, celebrate; LOD `sm` 24 px e `md` 48 px; pausa por
    `visibilitychange`/`IntersectionObserver`; reduced-motion congela pose);
  - `r/`: mesma cena com o runtime Rive mais leve disponível (`@rive-app/canvas-lite` ou equivalente; versão
    publicada há ≥ 2 semanas, fixada) e um `.riv` com state machine dos mesmos estados e input de cor; se não
    houver `.riv` autorado, usar um arquivo de exemplo público de complexidade equivalente (anotar qual) — o
    critério 1 (peso do runtime) já decide na maioria dos casos;
  - página de cena: 1 personagem `sm` num botão + 1 `md` + 20 controles vizinhos clicáveis + lista longa (para
    rolagem), build de produção (esbuild/vite minificado).
- Script `docs/design/mascote-spike/measure.mjs` (Playwright Chromium, já instalado no repo via `@hm/web`):
  CDP `Emulation.setCPUThrottlingRate { rate: 4 }`, 3 rodadas, mediana, mede os critérios 1–7 do ADR-006 §2
  (gzip -9 de todo asset carregado pela função; `web-vitals` `onINP` no roteiro de 20 cliques com aceno em loop
  forçado; `PerformanceObserver('long-animation-frame')` em 60 s; `Performance.getMetrics` em 30 s de repouso;
  troca de `data-theme` e de marca em execução; reduced-motion/aba oculta/fora da viewport sem frames;
  tempo até o quadro pose).
- Saída `docs/design/mascote-spike/RESULTADO.md` com a tabela e os comandos de reprodução, e o mesmo resumo
  preenchido no **ADR-006 §8** com a decisão final pela regra do §2 (R só vence passando os 7 **e** ganhando em
  expressividade no `/hm-designer` com capturas lado a lado).

## Fora de escopo

- Arte final (S02). Código no `@hm/ui` (S03). Qualquer arquivo de `apps/` ou `packages/`.

### files_allowed

- `docs/design/mascote-spike/**`
- `docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md`

## Definition of Done

- [ ] as duas implementações rodam a mesma cena com os mesmos estados
- [ ] tabela dos 7 critérios × S/R com mediana de 3 rodadas, versões exatas, hash do commit, CPU 4×
- [ ] capturas lado a lado (24 e 48 px, dois temas) e veredito do `/hm-designer` sobre expressividade
- [ ] ADR-006 §8 preenchido com a decisão e a justificativa pela regra do §2
- [ ] nada fora de `docs/` foi tocado (`git status`)

## Validação

```bash
node docs/design/mascote-spike/measure.mjs --check
```

## Notas

- Agente: `frontend-engineer` (`model: opus`): a medição define a arquitetura da fase.
- `--check` falha se `RESULTADO.md` não tiver os 7 critérios preenchidos para S e R.
- Se o Rive vencer, registrar no ADR que a arte do S02 passa a ser `.riv` autorada no editor Rive (trabalho com a
  ferramenta, possivelmente humano) e que o runtime é carregado só depois do LCP.
