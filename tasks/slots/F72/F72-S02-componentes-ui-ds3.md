---
id: F72-S02
title: Componentes do @hm/ui no DS 3.0 — botões, campos, status, tabela operacional e camadas
phase: F72
status: blocked
priority: critical
estimated_size: M
ui: true
depends_on: [F72-S01]
blocks: [F72-S04, F72-S05, F72-S06, F72-S07, F72-S08]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
---
# F72-S02 — Componentes do @hm/ui no DS 3.0

## Objetivo

Os componentes compartilhados seguem a seção "Components" da maquete: estados claros, feedback imediato, borda antes de sombra e raios deliberados. As telas que os usam herdam o visual novo sem mudança local.

## Escopo (faz)

- Button (primary, secondary, ghost, danger; loading, disabled e foco), IconButton, Input (campo e estados: foco, erro, sucesso, desabilitado, com ajuda), Card, Modal, Drawer, Toast, Avatar, Skeleton, EmptyState, ErrorState e HelpHint.
- **Novos**, se não existirem:
  - `Badge` / `StatusPill` (status, badges);
  - `Switch`;
  - `DataTable` operacional (cabeçalho fixo, número em mono à direita, densidade, linha com estado, vazio e carregando), no padrão "Operational table".
- Movimento pela linguagem do §05:
  - Lift no hover, State morph no toggle e Signal pulse só em estado vivo;
  - entrada com fade de 4 a 10px;
  - curvas e durações pelos tokens `--ease` / `--dur-*`;
  - `motion-reduce` em tudo.
- Stories (se o pacote usa Storybook) ou página de catálogo, e o `a11y.test.tsx` cobrindo os componentes novos.

### files_allowed

- `packages/ui/**`

## Definition of Done

- [ ] todos os componentes listados no visual do DS 3.0, nos dois temas
- [ ] componentes novos exportados e testados (estados e teclado)
- [ ] `a11y.test.tsx` verde; axe sem violação séria
- [ ] nenhum hex literal (lint)
- [ ] revisão `/hm-designer` contra a seção Components da maquete

## Validação

```bash
pnpm --filter @hm/ui typecheck
pnpm --filter @hm/ui test
pnpm --filter @hm/web typecheck
```

## Notas

- Agente: `frontend-engineer`. Paralelo à S03 (paths disjuntos).
