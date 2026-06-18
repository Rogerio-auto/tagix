---
id: F38-S08
title: Real-time suporte (Socket.io rooms + relay)
phase: F38
status: available
priority: high
estimated_size: M
depends_on:
  - F38-S07
blocks:
  - F38-S09
  - F38-S11
source_docs:
  - docs/features/SUPPORT.md
agent_id: backend-engineer
---
# F38-S08 — Real-time suporte

## Objetivo

Entregar mensagens de suporte em tempo real nos dois sentidos (membro ↔ equipe Leadium) via Socket.io, reusando o padrão de relay/rooms já existente. Habilita o chat ao vivo da UI do membro (S09) e do inbox platform (S11).

## Contexto

Socket.io já configurado (rooms via `socket.join`/`io.to(...)`; relay `hm.q.socket.relay` consumido pela API → `io.emit`). Conversas já usam esse padrão (`apps/api/src/routes/conversations/*`, services de socket). Reusar — não criar infra nova.

## Escopo (faz)

- **`apps/api/src/services/support-realtime.ts`** (novo) — join/leave de rooms `support:thread:<id>` (participantes) e `support:platform` (todos os platform admins); emit de `support:message` e `support:thread_updated`. Autorização de join: membro só entra no room de thread que `assertThreadVisible` permite; platform-admin entra no `support:platform`.
- **Wiring no socket bootstrap** (arquivo onde os handlers de socket são registrados — tocar só o ponto de registro) — registrar os handlers de support.
- **Emit nas mutações de S07** — `apps/api/src/routes/support.ts`: após persistir mensagem/mudança de status, emitir o evento (import do service). Tocar só os pontos de emit.
- **`apps/api/src/services/support-realtime.test.ts`** — autorização de join (membro fora do escopo não entra); emit chega ao room certo.

## Fora de escopo

- UI (S09/S11). Persistência/CRUD (S07). Schema (S01).

## Arquivos permitidos

- `apps/api/src/services/support-realtime.ts`
- `apps/api/src/services/support-realtime.test.ts`
- `apps/api/src/routes/support.ts`
- `apps/api/src/sockets/**`

## Arquivos proibidos

- `apps/web/**`, `packages/db/**`

## Definition of Done

- [ ] Membro recebe reply da equipe em tempo real e vice-versa; join autorizado por visibilidade.
- [ ] platform-admins recebem novos threads/mensagens no room `support:platform`.
- [ ] Test de autorização de join + emit; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Notas

Confirmar o caminho real do bootstrap de socket no repo (`apps/api/src/sockets/**` ou equivalente) antes de editar; ajustar `files_allowed` via COMMS.md se o path diferir. Não alargar além do registro de handlers.
</content>
