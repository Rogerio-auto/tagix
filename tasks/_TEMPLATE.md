---
id: F0-S00
title: Título curto e imperativo do slot
phase: F0
status: available
priority: medium
depends_on: []
---

# F0-S00 — Título curto e imperativo do slot

## Objetivo

Uma a três frases: o que este slot entrega end-to-end (vertical slice: schema + API + UI + teste quando aplicável).

## Escopo

### files_allowed

Liste os globs/paths que este slot pode tocar. Fronteira sagrada — não edite fora disto.

- `packages/exemplo/**`
- `apps/api/src/exemplo/**`

### files_forbidden

- (opcional) paths explicitamente proibidos mesmo que casem com allowed.

## Definition of Done

- [ ] Critério verificável 1
- [ ] Critério verificável 2
- [ ] RLS policy criada e testada (obrigatório em todo slot que cria tabela com `workspace_id`)
- [ ] Testes do feliz path passam

## Validação

Comandos shell que o `slot.py validate` roda (cada linha = um comando; falha em qualquer um reprova o slot):

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Notas

Decisões, links para docs (`docs/...`), riscos.
