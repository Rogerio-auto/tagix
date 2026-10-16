---
id: F76-S09
title: QA da F76 — axe nos dois temas, movimento reduzido, INP, peso e quadros longos, capturas e portão de design
phase: F76
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F76-S05, F76-S06, F76-S07, F76-S08]
blocks: []
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/design/copilot-botao-animacao.md
agent_id: qa-engineer
---
# F76-S09 — QA e portões da F76

## Objetivo

Provar com evidência que o personagem dá vida sem custar acessibilidade, desempenho ou atenção: axe limpo nos dois
temas e três marcas, movimento reduzido completo, peso dentro do teto, INP e quadros longos medidos com CPU 4× mais
lenta, capturas olhadas, e aprovação em `review-animations` e `/hm-designer`.

## Contexto

Barra de pronto da spec §8 e do cânone (`~/.claude/skills/canone/VERIFICACAO.md`). Último slot da F76.

## Escopo (faz)

- `apps/web/e2e/specs/mascot-a11y.spec.ts`: `expectNoSeriousAxe` no shell com launcher, nas rotas com
  `loading.tsx`, nos 6 vazios, recibo e intro — dark/light × Leadium/Maian/Odonto; personagem sempre
  `aria-hidden`; anúncio `aria-live` único no "pensando" e no briefing; foco e alvos ≥ 44 px no celular.
- `apps/web/e2e/specs/mascot-motion.spec.ts`: `prefers-reduced-motion: reduce` ⇒ nenhuma animação CSS ativa no
  personagem (`getAnimations()` vazio após a pose); `motion=off` ⇒ idem; aba oculta ⇒ zero frames; nada com
  frequência > 3 Hz (inspeção das animações em execução).
- `apps/web/e2e/perf/mascot.perf.spec.ts`: build de produção (`next build && next start`), CPU 4×, mediana de 3:
  INP p75 com o roteiro do S01 no shell real; LoAF > 50 ms atribuíveis = 0; CLS do shell = 0; peso gz de tudo da
  F76 (comparar com o registrado no S03) ≤ 30 KB; First Load JS compartilhado não cresce mais que o peso medido.
- Orçamento de atenção ponta a ponta com relógio falso: um dia simulado (sessão de 8 h com atividade sintética)
  ⇒ ≤ 4 chamadas, ≤ 10 varreduras, nenhuma nos 3 primeiros minutos, nenhuma digitando.
- Capturas 375/768/1440 × dark/light × 3 marcas × `motion` live/subtle/off em `apps/web/e2e/.artifacts/f76-s09/`,
  com folha de contato dos estados do personagem (24/48/128).
- `review-animations` sobre o diff da F76 e `/hm-designer` sobre as capturas: vereditos nas notas; reprovação abre
  slot de ajuste com valor exato.

### files_allowed

- `apps/web/e2e/specs/mascot-a11y.spec.ts`
- `apps/web/e2e/specs/mascot-motion.spec.ts`
- `apps/web/e2e/perf/mascot.perf.spec.ts`
- `apps/web/e2e/.artifacts/f76-s09/**`
- `tasks/slots/F76/F76-S09-qa-acessibilidade-desempenho-e-portao-de-design.md`

## Definition of Done

- [ ] axe sem violação séria em todas as combinações listadas
- [ ] reduced-motion, `off` e aba oculta provados por teste
- [ ] números de INP, LoAF, CLS e peso registrados nas notas e dentro dos limites
- [ ] simulação de um dia respeita o orçamento
- [ ] vereditos `review-animations` e `/hm-designer` APROVADOS (ou slots de ajuste listados)

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec playwright test e2e/specs/mascot-a11y.spec.ts e2e/specs/mascot-motion.spec.ts --workers=1
```

## Notas

- Agente: `qa-engineer`. O teste de desempenho roda à parte (build de produção) e é registrado nas notas; não
  entra na validação automática por depender de máquina.
