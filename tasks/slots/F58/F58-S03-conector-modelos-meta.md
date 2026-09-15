---
id: F58-S03
title: Buscar e enviar modelos de mensagem para a Meta
phase: F58
status: done
priority: critical
estimated_size: M
depends_on: [F58-S02]
blocks: [F58-S04]
agent_id: agent-f58-s03
source_docs:
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/features/CAMPAIGNS.md
claimed_at: 2026-08-11T14:33:59Z
completed_at: 2026-08-11T14:42:06Z

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

- [x] Listagem percorre paginação da Graph API até o fim, com limite defensivo e timeout.
- [x] Contrato normaliza nome, idioma, categoria, status, componentes, rejeição e identificador remoto.
- [x] Criação valida header/body/footer/buttons e variáveis antes de chamar a Meta.
- [x] Erros de permissão, payload, rate limit e indisponibilidade são tipados como permanentes ou transitórios.
- [x] Tokens e conteúdo sensível não aparecem em logs/exceções.
- [x] Testes cobrem paginação, status desconhecido, rejeição, 429/5xx e payload inválido.

## Validação

```bash
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/channels test
```

## Notas

- A versão da Graph API deve vir da fonte canônica já existente em `GraphClient`.

## Correção — auditoria de 2026-09-14

Este slot estava marcado como concluído com itens do DoD desmarcados. Cada item foi conferido
contra o código, os testes e produção.

- **Marcados agora (6):** tinham entrega, só faltava o registro. Evidência: Testes do conector de modelos cobrem paginação e 429.
- **Continuam em aberto (0):** anotados no próprio item com o motivo e o slot que
  assumiu o trabalho.

