---
id: F72-S05
title: Inbox no DS 3.0, com a lista acessível e o avatar sem número
phase: F72
status: blocked
priority: high
estimated_size: M
ui: true
depends_on: [F72-S02, F72-S03]
blocks: [F72-S09]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
  - tasks/slots/F70/F70-S37-inbox-mostra-o-nome-do-contato.md
---
# F72-S05 — Inbox no DS 3.0

## Objetivo

Lista, conversa, composer e painel do contato seguem o padrão "Inbox" da maquete, e os follow-ups da F70-S37 ficam fechados.

## Escopo (faz)

- `ChatList` / `ChatListItem` no ritmo do DS 3.0:
  - densidade, estado não lido, selos de canal e de IA;
  - a seleção ativa sem o neon animado (o DS 3.0 diz: movimento contínuo só em estado vivo).
- **Acessibilidade:** trocar o padrão `li role=option` com `<a>` dentro por `nav` + `ul` de links (`nested-interactive`, axe sério) e manter a navegação por setas.
- **Avatar:**
  - contato sem nome mostra ícone de pessoa (não `#`);
  - cor determinística por contato, a partir de um conjunto de tokens.
- Telefone visível como segunda linha quando houver homônimos na lista.
- Contraste do selo "IA" no claro.
- Bolhas de mensagem, composer (inclui a restrição de envio da F60-S11), painel do contato e cockpit no visual novo.
- Mobile: a aba Inbox.

### files_allowed

- `apps/web/features/conversations/**`
- `apps/web/app/(app)/conversations/**`
- `apps/web/e2e/specs/conversations*.spec.ts`, `apps/web/e2e/specs/mobile-inbox*.spec.ts`

## Definition of Done

- [ ] axe sem `nested-interactive`; navegação por setas preservada (teste)
- [ ] avatar sem nome com ícone; cor determinística (teste)
- [ ] fiel ao padrão Inbox da maquete nos dois temas, 375/1440
- [ ] e2e de inbox verde
- [ ] revisão `/hm-designer`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/conversations --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
