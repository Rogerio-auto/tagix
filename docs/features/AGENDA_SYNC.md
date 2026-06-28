# Feature — SINCRONIZAÇÃO COCKPIT ↔ AGENDA CENTRAL (F54)

> **Domínio:** Tempo real + UX sobre o módulo Calendar/Agenda (F7+F37+F53). Tornar a Agenda
> Central uma extensão viva do Cockpit: todo compromisso criado/editado/cancelado/concluído
> aparece automaticamente em ambos, em tempo real, já vinculado ao cliente.
> **Versão:** 1.0 (F54). **Status:** spec aprovada (decompor em slots).
> **Padrão:** DS v2 dark-first, RLS multi-tenant, zero `any`. Ver `UX_PRINCIPLES.md` + `MOBILE_UX.md`.

---

## 0. Premissa: camada de tempo real + visão, NÃO novo modelo

`events` continua a fonte única (F53). Esta feature adiciona (a) broadcast de mudança em tempo
real, (b) resumo do contato na listagem, (c) uma visão de follow-ups em lista por dia. Reusa o
padrão de tempo real já provado dos **negócios** (`deal-events.ts` → fila `hm.q.socket.relay` →
relay reemite para `ws:{id}`).

| Capacidade | Estado atual | Escopo F54 |
|---|---|---|
| Compromisso = fonte única c/ contato/tipo/prioridade/status | ✅ F53 | — |
| Card Agenda no Cockpit (próximos+histórico+ações) | ✅ F53-S04 | — |
| Agenda Central (calendário mês/semana/dia) + agenda mobile | ✅ F7/F37/F36 | enriquecer + tempo real |
| Tempo real de **negócios** (deal:* → relay → ws room) | ✅ F5-S07 | **espelhar p/ eventos** |
| Tempo real de **compromissos** entre telas | ❌ só invalida local | **Novo (S01+S02)** |
| Resumo do contato (nome/foto/telefone) na listagem | ❌ só contactId | **Novo (S01)** |
| Visão de follow-ups em lista por dia (vencidos/hoje, ações) | ❌ não existe | **Novo (S03)** |
| Automação cria evento → aparece em tempo real | ⚠️ cria (F53-S07), sem broadcast | **Novo (S04)** |

**Decisão travada:** broadcast é **workspace-wide** para a room `ws:{id}` (mesma do `deal:*`),
respeitando a visibilidade de calendário já vigente no cliente (a UI só mostra o que o membro
pode ver). Clientes reagem **invalidando o cache de eventos** (refetch), como no padrão de deals.

---

## 1. Backend — tempo real + enriquecimento (S01)

- Novos eventos socket em `packages/shared/src/socket-events.ts` (+ `SERVER_TO_CLIENT_EVENTS`):
  `event:created`, `event:updated`, `event:deleted`. Payload compacto:
  `{ eventId, workspaceId, contactId, conversationId, kind }` (o cliente refaz o fetch; payload
  só roteia a invalidação).
- Novo serviço `apps/api/src/services/event-realtime.ts` **espelhando `deal-events.ts`**:
  `emitEventCreated/emitEventUpdated/emitEventDeleted` publicam em `hm.q.socket.relay` via
  `makeEnvelope('socket.relay', workspaceId, ...)`. O relay (`socket/relay.ts`) já reemite por nome
  para `ws:{id}` — **sem mudança no relay** (basta o nome estar em `SERVER_TO_CLIENT_EVENTS`).
- `apps/api/src/routes/calendar/events.ts`: emitir após cada mutação — POST→created, PUT→updated
  (inclui transições de status: in_progress/postponed/completed), `/:id/cancel`→updated(cancelled).
  Best-effort (`void emit...`, não bloqueia a resposta), como os deals.
- **Enriquecimento:** `GET /api/events` e `GET /api/events/:id` passam a incluir, por evento, um
  `contact` resumido `{ id, name, avatarUrl|null, phone|null }` (join em `contacts`). Sem contato
  vinculado → `contact: null`. Não quebra contrato existente (campo aditivo).

## 2. Frontend — ouvinte de tempo real (S02)

- `apps/web/shared/realtime/useEventsRealtime.ts`: assina `event:created/updated/deleted` via
  `useSocket()` e invalida as queries `['events']` + `['event', id]` (TanStack Query). Como o cache
  é global, invalidar de um único ponto atualiza **Cockpit e Agenda ao mesmo tempo** —
  bidirecional por construção.
- Montar o hook **uma vez** no `AppLayout` (ao lado dos demais provedores globais), para valer em
  qualquer tela aberta. Sem reescrever o `SocketProvider`.

## 3. Frontend — Agenda Central: visão lista por dia (S03)

- Nova visão "Lista/Follow-ups" em `features/calendar` (toggle ao lado de Mês/Semana/Dia):
  **agrupada por dia**, ordenada por horário. **Vencidos** (passado, não-terminal) e **hoje** em
  destaque visual (tokens DS v2, sem hex).
- Cada item = **cartão do cliente**: foto (Avatar de `@hm/ui`, fallback iniciais), nome, telefone,
  data/horário, **tipo** (ícone), **prioridade** (badge), **status** (badge), descrição.
- **Ações rápidas** por item: Abrir conversa (`conversationId`→`/conversations/:id`), Abrir cockpit
  (mesma conversa, painel direito), Editar, Reagendar, Concluir, Cancelar. Reusar
  `QuickScheduleModal`/`AppointmentDetail` de `features/cockpit-agenda` onde fizer sentido.
- Enriquecer também a **grade (FullCalendar)** e a **agenda mobile**: mostrar o cliente no evento e
  as ações no detalhe (`EventDetailModal`). Consome o `contact` resumido do S01.

## 4. Worker — automação emite em tempo real (S04)

- `apps/workers/src/automations/**`: ao criar evento pelo port `create_event` (F53-S07), publicar
  `event:created` no relay (reusar o canal/relay como o `calendar-reminders` faz com
  `appointment:due`). Idempotente; best-effort.

## 5. QA (S05)

- Integração + adversarial da sincronização: corrida criar/editar/cancelar em telas concorrentes,
  duplicatas, escopo de visibilidade (não vazar evento de calendário privado), reconexão de socket.
  e2e não roda neste host → typecheck/lint/unit + revisão.

---

## 6. Decomposição (slots F54)

| Slot | Camada | Objetivo | depends_on |
|---|---|---|---|
| F54-S01 | api+shared | socket event:* + emit nas mutações + `contact` resumido na listagem | — |
| F54-S02 | web | hook `useEventsRealtime` + mount global no AppLayout | S01 |
| F54-S03 | web | Agenda Central: visão lista por dia + grade/mobile/detalhe + ações rápidas | S01 |
| F54-S04 | workers | automação `create_event` emite `event:created` | S01 |
| F54-S05 | qa | QA + adversarial da sincronização bidirecional | S02, S03, S04 |

Grafo: `S01 → {S02, S03, S04} → S05`.
