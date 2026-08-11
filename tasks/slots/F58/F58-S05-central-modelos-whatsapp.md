---
id: F58-S05
title: Entregar a Central de Modelos do WhatsApp
phase: F58
status: available
priority: high
estimated_size: L
depends_on: [F58-S04]
blocks: [F58-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
---

# F58-S05 — Entregar a Central de Modelos do WhatsApp

## Objetivo

Dar ao administrador um lugar único para ver o que pode ser enviado, sincronizar
com a Meta, criar um modelo e entender por que ele ainda não está disponível.

## Escopo

### files_allowed

- `apps/web/app/(app)/settings/channels/[id]/message-templates/**`
- `apps/web/features/channels/message-templates/**`
- `apps/web/features/channels/components/ChannelListItem.tsx`

### files_forbidden

- `apps/api/**`
- `apps/web/features/campaigns/**`

## Definition of Done

- [ ] Canal WhatsApp oferece ação **Modelos de mensagem**; Instagram/WAHA explicam por que não oferecem.
- [ ] Lista mostra nome amigável, idioma, categoria, status e última sincronização.
- [ ] Filtros e busca funcionam; estados vazio/loading/erro/permissão são acionáveis.
- [ ] Botão **Sincronizar agora** mostra progresso e resumo sem duplicar itens.
- [ ] Formulário **Criar modelo** possui preview de celular, variáveis e validação inline.
- [ ] Rejeição/pausa mostra motivo e próxima ação; aprovado oferece **Usar em campanha**.
- [ ] Layout funciona em mobile e desktop com componentes/tokens do DS.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm --filter @hm/web build
```

## Notas

- O usuário não precisa conhecer o identificador interno da Meta para operar esta tela.
- Neste slot, a criação oferece cabeçalho de texto; modelos de mídia sincronizados continuam visíveis na prévia. Upload de `header_handle` fica fora do MVP.
- **Usar em campanha** abre `/campaigns/new?channelId=...&messageTemplateId=...`; o consumo desses parâmetros pertence ao F58-S13.
