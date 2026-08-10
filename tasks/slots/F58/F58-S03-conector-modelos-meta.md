---
id: F58-S03
title: Buscar e enviar modelos de mensagem para a Meta
phase: F58
status: available
priority: critical
estimated_size: M
depends_on: [F58-S02]
blocks: [F58-S04]
agent_id: backend-engineer
source_docs:
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/features/CAMPAIGNS.md
---

# F58-S03 — Buscar e enviar modelos de mensagem para a Meta

## Objetivo

Entregar um cliente tipado para listar todos os modelos da WABA e enviar novos
modelos para aprovação, normalizando a resposta externa num contrato estável do
produto.

## Escopo

### files_allowed

- `packages/channels/src/meta/templates/**`
- `packages/channels/src/index.ts`

### files_forbidden

- `apps/**`
- `packages/db/**`

## Definition of Done

- [ ] Listagem percorre paginação da Graph API até o fim, com limite defensivo e timeout.
- [ ] Contrato normaliza nome, idioma, categoria, status, componentes, rejeição e identificador remoto.
- [ ] Criação valida header/body/footer/buttons e variáveis antes de chamar a Meta.
- [ ] Erros de permissão, payload, rate limit e indisponibilidade são tipados como permanentes ou transitórios.
- [ ] Tokens e conteúdo sensível não aparecem em logs/exceções.
- [ ] Testes cobrem paginação, status desconhecido, rejeição, 429/5xx e payload inválido.

## Validação

```bash
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/channels test
```

## Notas

- A versão da Graph API deve vir da fonte canônica já existente em `GraphClient`.
