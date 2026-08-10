---
id: F58-S07
title: Tornar o início da campanha fácil de entender
phase: F58
status: available
priority: high
estimated_size: S
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/UX_PRINCIPLES.md
---

# F58-S07 — Tornar o início da campanha fácil de entender

## Objetivo

Criar a primeira etapa do novo fluxo com escolhas reconhecíveis pelo usuário:
objetivo/nome, WhatsApp conectado e envio único ou sequência de mensagens.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/basics/**`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/api/**`

## Definition of Done

- [ ] Opções usam **Envio único** e **Sequência de mensagens**, com exemplo curto de cada uma.
- [ ] `Broadcast`, `Drip` e `Triggered` não aparecem na interface.
- [ ] Somente canais elegíveis podem ser selecionados; canal desconectado oferece caminho para configuração.
- [ ] Seleção informa que modelos aprovados são necessários antes de avançar.
- [ ] Validação é inline, preserva dados ao voltar e possui testes de teclado/mobile.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
```

## Notas

- A integração com o orquestrador do wizard pertence ao F58-S12.
