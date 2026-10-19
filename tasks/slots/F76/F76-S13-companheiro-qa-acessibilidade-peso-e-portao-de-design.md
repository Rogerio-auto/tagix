---
id: F76-S13
title: Companheiro das telas de acesso — QA (capturas, axe, peso, LCP/CLS, privacidade) e portão de design
phase: F76
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F76-S11, F76-S12]
blocks: []
source_docs:
  - docs/design/auth-companion/SPEC.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
agent_id: qa-engineer
---
# F76-S13 — QA e portões do companheiro

## Objetivo

Provar que o companheiro cumpre a emenda do ADR-006 §9 e a barra world-class: sem custo de LCP/CLS, dentro do
orçamento de peso, acessível, privado, e com gosto aprovado.

## Escopo (faz)

- `apps/web/e2e/specs/auth-companion.spec.ts`: capturas em 375/768/1440 × claro/escuro × movimento normal/reduzido nas
  telas login, signup, signup-sent, verify (pendente, ok, inválido), reset (pedido, enviado, nova, feita) e convite;
  quadros-chave: chegada com balão, `perch`, `avert`, `thinking`, `confused`, cada tempo do sucesso. `expectNoSeriousAxe`
  nos dois temas; `expectTextContrast` no balão (≥ 4,5:1). Reaproveitar `auth-ds3.spec.ts`.
- `apps/web/e2e/perf/auth-companion.perf.spec.ts`: peso (acha `COMPANION_CHUNK_MARKER` em `.next/static/chunks/*.js`,
  gzip -9: **≤ 12 KB meta, 30 KB teto duro**; o marcador não pode estar nos scripts iniciais da rota); LCP fora de
  `[data-companion]`; soma de `layout-shift` < 0,01; ociosidade (15 s parado ⇒ `document.getAnimations()` só com o
  piscar ou nada; aba oculta/fora da viewport ⇒ 0).
- Privacidade: busca (Haiku) por `.value`, `keydown`, `fetch`, `sendBeacon` e hex em `features/auth/companion/**`.
- Mobile: sem voo; caixa reservada; balão some com o teclado aberto.
- Portões (Opus, nos documentos do slot): `/hm-designer` e `review-animations`.

### files_allowed

- `apps/web/e2e/specs/auth-companion.spec.ts`
- `apps/web/e2e/perf/auth-companion.perf.spec.ts`
- `apps/web/e2e/.artifacts/f76-s13/**`

### files_forbidden

- `apps/web/features/auth/companion/**` (achado volta ao S11)

## Definition of Done

- [ ] todos os critérios acima verdes, números registrados nas notas
- [ ] `/hm-designer` e `review-animations` aprovados (veredito nas notas)
- [ ] `next build` de produção do web verde

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec playwright test e2e/specs/auth-companion.spec.ts
```

## Notas

- Agente: `qa-engineer` (Sonnet escreve), `executor` (Sonnet roda), `leitor` (Haiku confere buscas), Opus julga.
