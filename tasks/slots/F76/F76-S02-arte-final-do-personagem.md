---
id: F76-S02
title: Arte final do personagem com rig em camadas, LODs de 16 a 160 px, folha de estados e variantes por marca
phase: F76
status: blocked
priority: critical
estimated_size: M
model: opus
ui: true
depends_on: [F76-S01]
blocks: [F76-S03]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/design/copilot-botao-animacao.html
  - docs/DESIGN_SYSTEM.md
agent_id: frontend-engineer
---
# F76-S02 — Arte final do personagem

## Objetivo

O personagem C deixa de ser conceito: arte final coerente com o DS 3.0, legível a 24 px (sem braços em repouso),
expressiva a 48–160 px, com camadas e pivôs estáveis que o código anima, e cores 100% por token em três marcas e
dois temas. Aprovada no portão `/hm-designer` antes de qualquer código de componente.

## Contexto

Spec §3.1, ADR-006 §3. Formato depende do spike (S01): **S** ⇒ SVG por LOD; **R** ⇒ `.riv` autorado no editor
Rive com as mesmas camadas e inputs (se R vencer, este slot precisa de alguém com a ferramenta; o orquestrador
avisa o Rogério antes do claim).

## Escopo (faz)

- `packages/ui/src/Mascot/art/`:
  - `xs.svg` (16–20), `sm.svg` (24), `md.svg` (48), `lg.svg` (128) — cada um desenhado na própria grade
    (viewBox = tamanho), traços em pixel inteiro, camadas com `id`/classe exatamente: `fig`, `body`, `head`,
    `visor`, `eyes-open`, `eyes-closed`, `eyes-happy`, `eyes-squint`, `antenna`, `antenna-tip`, `arm-l`, `arm-r`,
    `hand-r` (o `sm` não tem `arm-l`; `arm-r` do `sm` fica oculto em repouso e tem traço ≥ 2 px);
  - `rig.json`: pivô (`transform-origin`) de cada camada por LOD, limites de rotação e deslocamento por estado;
  - cores **só** por `var(--m-ink|--m-fill|--m-accent|--m-visor|--m-eye|--m-cut)`; nenhum hex no SVG;
  - glifo de fallback `glyph.svg` (marcas `glyph`, ex.: Odonto): o glifo de órbita aprovado da maquete, parado.
- `docs/design/mascote/folha.html` (abre no navegador): folha de estados (pose de entrada, pico, saída de idle,
  blink, wave, play, thinking, celebrate, sleep, confused, peek, look) por LOD, alternando tema e marca
  (Leadium, Odonto = glifo, Maian), sobre `--surface` e `--surface-2`; e lado a lado com o rig do demo.
- Capturas em `docs/design/mascote/` (24/48/128 px × dark/light × Leadium/Maian + glifo Odonto).
- Paleta proposta do personagem por marca e tema (tabela no `folha.html`), com contraste medido: traço `--m-ink`
  ≥ 3:1 sobre `--surface` e `--surface-2` (componente gráfico, WCAG 1.4.11); Maian com mascote `#D4610F`
  (proposta da maquete) conferido; os valores entram como tokens no S03.

## Fora de escopo

- Componente React, máquina de estados, tokens no CSS (S03).

### files_allowed

- `packages/ui/src/Mascot/art/**`
- `docs/design/mascote/**`

## Definition of Done

- [ ] 4 LODs + glifo, camadas e pivôs conforme o contrato; zero hex nos SVGs (grep)
- [ ] a 24 px, em captura real 1× e 2×, cabeça, visor e olhos legíveis; nenhum traço < 1 px renderizado
- [ ] folha de estados completa nos dois temas e três marcas
- [ ] contraste do traço ≥ 3:1 medido e tabelado
- [ ] `/hm-designer` APROVADO (critério: "se poderia pertencer a qualquer produto, reprova"; nada de roxo,
      faísca, brilho, gradiente interno) — veredito nas notas do slot

## Validação

```bash
node -e "const fs=require('fs');const d='packages/ui/src/Mascot/art';for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.svg'))){const s=fs.readFileSync(d+'/'+f,'utf8');if(/#[0-9a-fA-F]{3,8}\b/.test(s)){console.error('hex em '+f);process.exit(1)}}"
```

## Notas

- Agente: `frontend-engineer` com olhar de ilustrador; usar a skill `animate` só para conferir que os pivôs
  suportam os movimentos da spec §3.2.
