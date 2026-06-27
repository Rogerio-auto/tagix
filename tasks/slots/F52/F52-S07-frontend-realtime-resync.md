---
id: F52-S07
title: Frontend realtime — resync ao reconectar + listener de status + UI de mídia (erro/retry)
phase: F52
status: blocked
priority: high
estimated_size: M
depends_on: [F52-S04, F52-S05, F52-S06]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/LIVECHAT.md
  - docs/UX_PRINCIPLES.md
---
# F52-S07 — Frontend realtime resiliente

> **Origem:** survey desta sessão. Fragilidades: sem resync ao reconectar (eventos offline somem), sem listener de `message:status_changed` (status só atualiza na próxima mensagem), mídia falha = placeholder eterno.

## Objetivo

A interface deve refletir o estado real da conversa: resincronizar ao reconectar o socket, atualizar status de envio em tempo real, e mostrar erro/retry amigável de mídia em vez de placeholder infinito.

## Contexto / causa raiz (confirmada)

`apps/web/shared/realtime/SocketProvider.tsx`: socket.io reconecta sozinho, mas no evento `connect` **nada é refetchado** → mensagens/status/mídia que chegaram offline somem. `useConversationSocket` não escuta `message:status_changed` → status fica `pending` até a próxima `message:new`. `MessageBubble` usa o mesmo placeholder para "carregando" e "falhou", sem `onerror`, sem retry.

## Escopo (faz)

- **Resync no `connect`/reconnect:** ao (re)conectar, invalidar as queries `['conversations']`, `['conversation', id, 'messages']`, `['conversation', id, 'detail']` para fechar o gap de eventos perdidos durante a desconexão.
- **Listener `message:status_changed`:** invalidar/atualizar a query de mensagens da conversa ao receber o evento (status enviado→entregue→lido em tempo real, sem esperar próxima mensagem).
- **Listener `message:media_failed`** (evento de F52-S05): marcar a mídia como falha na UI.
- **MessageBubble — estados de mídia distintos:** `pending/downloading` → indicador de carregando; `failed` → mensagem amigável + botão "Tentar novamente"; `onerror` no `<img>/<video>/<audio>` → chamar o endpoint de refresh (F52-S06) e reidratar a URL; só então mostrar erro se persistir.
- Dedup defensivo no cliente ao mesclar socket + refetch (evitar bolha duplicada visual).

## Fora de escopo

- Backend (eventos, endpoints já entregues por F52-S04/05/06).
- Painel de monitoramento operacional (F52-S09).
- Mudar contratos de socket-events (são de F52-S05).

## Arquivos permitidos

- `apps/web/shared/realtime/**`
- `apps/web/features/conversations/**`

## Arquivos proibidos

- `apps/web/features/monitoring/**` (F52-S09) · `apps/api/**` · `packages/**`

## Definition of Done

- [ ] Ao reconectar o socket, as queries da conversa aberta e da lista são refetchadas (testável via mock do evento `connect`).
- [ ] `message:status_changed` atualiza o ícone de status sem chegar nova mensagem.
- [ ] Mídia `failed` mostra erro amigável + botão de retry; `onerror` tenta refresh de URL antes de declarar falha.
- [ ] Sem bolhas duplicadas ao receber socket + refetch.
- [ ] `pnpm typecheck` + `pnpm lint` + (testes web disponíveis: vitest do @hm/web) verdes.

## UX considerations (docs/UX_PRINCIPLES.md)

- **Estados explícitos (default/loading/error):** mídia precisa de estado de erro distinto do loading — hoje viola ao usar o mesmo placeholder.
- **Feedback em tempo real sem reload:** status e mídia atualizam sem F5 (princípio de realtime do produto).
- **Recuperação acionável:** erro de mídia oferece retry, não beco sem saída.
- **Sem flicker:** transição loading→mídia suave ao reidratar.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- e2e Playwright não roda verde neste host (memória do projeto); validar por typecheck/lint/unit (vitest do @hm/web, harness existente da F41-S04).
- Não hardcodar hex; usar tokens DS v2 para o estado de erro (ex.: `text-danger`).
- O listener de `message:status_changed` provavelmente entra em `useConversationMessagesLive`.
