# Feature — AGENDA INTELIGENTE NO COCKPIT (F53)

> **Domínio:** Camada de acompanhamento comercial sobre o módulo Calendar — agendar, lembrar e
> executar follow-ups sem sair da conversa.
> **Pacotes:** `apps/web/features/cockpit-agenda`, `apps/web/features/conversations`,
> `apps/web/features/notifications`, `apps/api/src/routes/calendar`, `apps/workers/src/calendar-reminders`,
> `apps/workers/src/automations`, `packages/db`, `packages/shared`.
> **Versão:** 1.0 (F53). **Status:** spec aprovada (decompor em slots).
> **Padrão:** DS v2 dark-first, RLS multi-tenant, zero `any`. Ver `UX_PRINCIPLES.md` + `MOBILE_UX.md`.

---

## 0. Premissa: NÃO é um build do zero

O survey (F7 + F37) confirma que **a maior parte da infraestrutura já existe** e DEVE ser reusada.
Esta feature é uma **camada de integração + UX + notificações** sobre o módulo Calendar — nunca um
sistema paralelo de "tarefas".

| Capacidade do spec do founder | Estado atual | O que falta (escopo F53) |
|---|---|---|
| Modelo de dados de compromissos vinculados a contato | ✅ `events` tem `contactId`/`dealId`/`conversationId`, participantes, recorrência, RLS | Estender `type`/`status` + `priority` |
| Endpoints CRUD + consulta por contato | ✅ `GET/POST/PUT /api/events`, `?contact=`, cancel, RSVP | Validar novos campos + transições de status |
| Calendário dia/semana/mês | ✅ `apps/web/features/calendar` (FullCalendar) | Clicar evento → abrir conversa (wiring) |
| Lembrete agendado | ✅ worker `calendar-reminders` (offsets 1d + 1h) | Emit "na hora" (offset 0) + canal in-app |
| Agente IA agenda | ✅ tools `schedule_event`/`get_available_slots` | Aceitar novos campos |
| **Card Agenda no Cockpit** | ❌ não existe | **Novo** (S04) |
| **Modal de agendamento rápido + atalhos** | ⚠️ existe `EventForm` (calendário), não cockpit | **Novo modal leve** (S03) |
| **Notificação in-app em tempo real + som + persistente** | ❌ `notifyOrganizer` é só auditLog; sem central in-app | **Novo** (S05 + S06) |
| **Histórico do contato** | ⚠️ eventos persistem; sem view | **Nova view** (S04) |
| **Compromisso dispara ação/flow** | ⚠️ port `create_event` é stub (`MissingPortError`) | **Fechar port + due→ação** (S05 + S07) |

**Decisão travada:** `events` é a fonte única da verdade de compromissos. Reusar, estender — não
duplicar. Um "compromisso comercial" é um `event` com `contactId` preenchido.

---

## 1. Modelo de dados (delta sobre Calendar 2.0)

`events` já existe (`packages/db/src/schema/calendar.ts`). `status` e `type` são colunas `text` com
**check constraints** (`events_status_chk`, `events_type_chk`) — estender = dropar/recriar a constraint
na migration. Tudo retrocompatível (defaults preservados).

- **`type`** (`events_type_chk`): adicionar `call` (ligação), `whatsapp`, `billing` (cobrança),
  `proposal` (envio de proposta), `custom` (personalizado). Mantém os 6 atuais.
- **`status`** (`events_status_chk`): adicionar `in_progress` (em andamento), `postponed` (adiado).
  Mantém `scheduled`/`confirmed`/`cancelled`/`completed`. Identidade visual por estado no frontend.
- **`priority`** (nova coluna `text`, default `'medium'`, check `low|medium|high`).
- **Due-action** (compromisso dispara ação ao vencer): armazenado em `events.metadata.dueAction`
  (jsonb já existe) — `{ kind: 'trigger_flow'|'send_message'|'move_stage'|'add_tag'|'notify_members', ... }`.
  Sem nova coluna; validado por Zod na API.

RLS de `events` já cobre (escopo por `workspace_id`). Nenhuma policy nova. Migration idempotente,
sequenciada após a última (sem colisão de journal).

---

## 2. API (delta sobre `/api/events`)

Rotas existem. O delta é de **validação** e **transição de status**:

| Método | Path | Perm | Delta F53 |
|---|---|---|---|
| POST | `/api/events` | `event.edit` | aceitar `priority`, novos `type`, `metadata.dueAction` (Zod) |
| PUT | `/api/events/:id` | `event.edit` | aceitar `priority`, transições `status` (→ `in_progress`/`postponed`/`completed`), `dueAction` |
| GET | `/api/events?contact=&from=&to=` | `calendar.view` | já filtra por contato — sem mudança de contrato |

- Máquina de transição de status validada server-side (ex.: `cancelled`/`completed` são terminais;
  `postponed` exige novo `startAt`). Erros → 422 com mensagem PT-BR (UX §2.11).
- Tool de agente `schedule_event` (`apps/api/src/internal/tools/calendar-handlers.ts`) aceita
  `priority`/novos `type` (mesmo contrato).

---

## 3. Frontend

### 3.1 Card "Agenda" no Cockpit (`features/cockpit-agenda` + `ContactInfoPanel`)
- Section nova no `ContactInfoPanel`, seguindo o padrão `Section`/`Card` existente (DS v2, sem hex).
- **Próximos compromissos** (lista compacta ordenada): `Amanhã • 09:00 • Retornar ligação`. Ícone por
  `type`, cor/badge por `priority` e `status`.
- **Histórico** (timeline §3.9 do UX): compromissos `completed`/`cancelled` do contato, com check.
- Estados explícitos (UX §2.6/§2.7): empty (`Nenhum compromisso agendado` + CTA), loading (skeleton),
  error (3 partes). Sem contato vinculado → orienta vincular.
- Clicar no compromisso → abre detalhe (drawer/sheet, UX §2.3) com ação "Abrir conversa"
  (`event.conversationId` → `/conversations/:id`).
- Botão **+ Novo Agendamento** → abre o modal rápido (S03).

### 3.2 Modal de agendamento rápido (`features/cockpit-agenda/QuickScheduleModal`)
- Modal leve (não full-screen — UX §2.3 exceção: criação curta). Campos: **Data**, **Hora**, **Tipo**
  (7 opções), **Descrição**, **Prioridade** (baixa/média/alta).
- **Atalhos de data** (1 clique): `Hoje 17h` · `Amanhã` · `Daqui 3 dias` · `Próxima semana` ·
  `Próximo mês` · `Personalizar`. Lógica pura testável (`quickDates.ts` + teste).
- Pré-preenche `contactId`/`conversationId` do cockpit. Feedback imediato (UX §2.7) + toast.

### 3.3 Central de notificações + som (`features/notifications`)
- Consome o evento socket de compromisso vencido (S05). **Inbox persistente** até o operador
  descartar ou concluir (UX §2.12 — nível "inbox"). Mostra nome do cliente + descrição + botão
  "Abrir conversa".
- **Som** configurável em `/settings/me/notificacoes`: ativado/desativado, volume, repetir até
  confirmação, apenas visual. Respeita agrupamento (UX §2.12) e `prefers-reduced-motion`.

---

## 4. Tempo real & scheduler

- **Lembrete "na hora"**: `calendar-reminders` ganha offset `0` (vencimento) e, em vez de só auditLog,
  **emite via socket relay** (`apps/api/src/socket/relay.ts`) para `member:<id>`/`ws:<id>` um evento
  novo em `packages/shared/src/socket-events.ts` (ex.: `appointment:due`). Idempotente via
  `events.metadata.remindersSent` (padrão já existente).
- **Compromisso → ação** (S07): ao vencer, se `metadata.dueAction` presente, enfileira a ação
  reusando os ports existentes (`flowQueuePort.triggerFlow`, outbound, `move_stage`, `add_tag`).
  Fecha também o stub `create_event` em `apps/workers/src/automations/executors.ts` (automação cria evento).

---

## 5. Permissões

Reusa a matriz de Calendar (`PERMISSIONS.md §2.x`): `calendar.view` (ALL) para ver/listar,
`event.edit` (STAFF) para criar/editar/transicionar, ownership fino já vigente. Central de
notificações é **pessoal** (sem permissão nova). Nenhuma alteração em `PERMISSIONS.md`.

---

## 6. Não-objetivos F53 (escalabilidade futura)

Projetar para suportar, **sem implementar agora**: sync Google/Outlook Calendar (CalDAV), calendário
compartilhado entre equipes além do já existente, lembretes múltiplos por evento, etiquetas próprias de
compromisso, painel/dashboard de produtividade de tarefas, filtros por operador no calendário.

---

## 7. Decomposição (slots F53)

| Slot | Camada | Objetivo | depends_on |
|---|---|---|---|
| F53-S01 | db | `events`: `priority` + estender `type`/`status` + migration | — |
| F53-S02 | backend | API/tool: validar novos campos + transições de status | S01 |
| F53-S03 | frontend | Modal rápido + atalhos de data (puro testável) | S02 |
| F53-S04 | frontend | Card Agenda + Histórico no Cockpit + abrir conversa | S03 |
| F53-S05 | worker | Lembrete "na hora" + evento socket + due→ação | S01 |
| F53-S06 | frontend | Central de notificações persistente + som | S05 |
| F53-S07 | worker | Fechar port `create_event` (automação cria evento) | S01 |

Grafo: `S01 → {S02 → S03 → S04}`, `S01 → S05 → S06`, `S01 → S07`.
