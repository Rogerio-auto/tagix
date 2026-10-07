---
id: F72-S07
title: Varredura do app no DS 3.0 — contatos, campanhas, agentes, flows, conhecimento, conversões e configurações
phase: F72
status: blocked
priority: high
estimated_size: L
ui: true
depends_on: [F72-S02, F72-S03]
blocks: [F72-S09]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
---
# F72-S07 — Varredura das telas do app

## Objetivo

Nenhuma tela do app fica "meio v2". Cada uma usa os componentes da S02, a tabela operacional onde houver lista e número em mono, e respeita o ritmo do DS 3.0.

## Escopo (faz)

- Telas e features:
  - `contacts`, `campaigns` (lista, editor, detalhe), `agents` (lista, detalhe, wizard), `flow-builder` (lista, backup e o canvas: nós e arestas nos tokens), `knowledge`, `conversions`, `products`;
  - `settings` (todas as seções, `billing`, `usage`, `channels`, templates, `meta`, `calendar`), `onboarding` (wizard, checklist, tour), `notifications`, `invites` (seção de membros), `lead-ads`, `meta-connection`, `channels`, `developers`, `support`, `billing`, `usage`.
- Trocar listas com cara de tabela pelo `DataTable`; números (valor, contagem, %) em mono.
- Zerar o hex/locale/fuso literal nos arquivos tocados (regras da F59-S08).
- `useIsReadOnly` (F71-S08) nos botões de escrita principais de cada feature tocada. Absorve o F71-S17.

### files_allowed

- `apps/web/features/{contacts,campaigns,agents,flow-builder,knowledge,conversions,products,settings,onboarding,notifications,invites,lead-ads,meta-connection,channels,developers,support,billing,usage}/**`
- `apps/web/app/(app)/{contacts,campaigns,agents,flows,knowledge,conversions,settings}/**`
- `apps/web/e2e/specs/**` (só ajustes de seletor quebrados pela repintura, sem afrouxar asserção)

## Definition of Done

- [ ] checklist por tela nas Notas de execução (tela → feito → captura)
- [ ] avisos de lint hex/locale/fuso: o número cai (antes/depois registrado)
- [ ] e2e da suíte inteira verde (`--workers=1` se a máquina não aguentar)
- [ ] axe sem violação séria nas telas tocadas, nos dois temas
- [ ] revisão `/hm-designer` por amostragem (no mínimo uma tela de cada feature)

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run features --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Grande: o orchestrator pode dividir em sub-lotes por feature, mantendo os paths disjuntos.
