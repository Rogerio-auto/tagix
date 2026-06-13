# Feature — LIVECHAT OPERAÇÃO 2.0 (F30)

> **Domínio:** camada de operação do atendente sobre o LiveChat núcleo — cockpit de ações, IA on/off com handoff consciente, distribuição e privacidade de conversas.
> **Pacotes:** `packages/db`, `packages/shared`, `apps/api`, `apps/workers`, `apps/agent-runtime`, `apps/web/features/conversations`, `apps/web/features/settings`
> **Origem:** diagnóstico de gaps do LiveChat (header oco, sem toggle de IA, sem enforcement de visibilidade). Complementa [`LIVECHAT.md`](./LIVECHAT.md) e [`PERMISSIONS.md`](./PERMISSIONS.md).

---

## 0. Diagnóstico (o que motivou)

O LiveChat núcleo (F1/F15) tem fundação sólida, mas a **camada de operação está oca**:

- O header da conversa (`ConversationsLayout.tsx`) tem só um label + `FlowExecutionsBadge` + botão Info. As ações prometidas em `LIVECHAT.md §7.3` (resolver, snooze, transfer, attach-deal) nunca foram montadas.
- **Não há toggle de `ai_mode`** — a coluna existe (off/on/paused) e o worker a respeita, mas não há API nem UI para ligar/desligar a IA por conversa.
- `RoutingMenu` existe mas está enterrado no `ContactInfoPanel` passando `assignedTo={null} departmentId={null}` hardcoded — não reflete o estado real.
- `GET /api/conversations` é escopada por workspace (RLS) mas **não aplica scoping por departamento/role/peer** — qualquer AGENT vê o workspace inteiro, violando a matriz `PERMISSIONS.md §2.1`. Gap de praticidade **e** de privacidade.
- `teams.auto_assign_strategy` existe no schema mas **não há engine** que distribua conversas no inbound.

---

## 1. Modelo de privacidade — DOIS eixos

### 1.1 Entre escopos (quais depts/times o membro enxerga)

Política por **role**, configurável no workspace, com **override por membro**:

| Role | Default |
|---|---|
| OWNER / ADMIN | Todos os departamentos |
| SUPERVISOR | Departamentos que lidera (via `team_members.role='lead'`) |
| AGENT | Apenas departamentos a que pertence (via `team_members`) |
| READONLY | Conforme política (default: todos, leitura) |

**Override por membro:** o dono pode conceder a um membro específico visibilidade extra a departamentos além dos seus (`member_visibility_overrides`).

### 1.2 Entre colegas, dentro do mesmo escopo (privacidade de negociação)

Mesmo dois agentes do mesmo time/dept: um vê a conversa do outro, ou só as suas?

- **Default no workspace:** `shared` (todos do escopo veem tudo) ou `private` (cada um só as suas atribuídas).
- **Override por time:** `teams.peer_visibility` ∈ `shared | private | inherit` (inherit = usa o default do workspace).
- **Lead/supervisor do time sempre vê tudo do time**, mesmo em modo `private`.

**Resolução de peer-privacy para uma conversa:**
```
team_id presente  → team.peer_visibility (se 'inherit' → workspace.default_peer_visibility)
team_id ausente   → workspace.default_peer_visibility
```

### 1.3 Estrutura dept → time → conversa

- **Time é opcional.** Uma conversa pode ficar solta no departamento (sem time). Departamento agrupa times.
- Conversa com time → privacidade resolve pelo time; conversa sem time → cai no default do workspace.

---

## 2. IA on/off com handoff consciente

`conversations.ai_mode` ∈ `off | on | paused`.

- **Toggle manual** (on/off/pause/resume) — API + UI no painel/header.
- **Auto-pausa no handoff:** quando um humano envia mensagem numa conversa `ai_mode='on'`, ela vira `paused` (não atropela o atendente). Registra `ai_paused_reason='human_takeover'`, `ai_paused_at`, `ai_paused_by`.
- **Retomada consciente de contexto:** quando a IA volta (manual OU por gatilho), ela **nunca retoma cega**. O builder de contexto do agent-runtime rotula a autoria de cada mensagem (`human | ai | contact`) e injeta uma diretriz de handoff ("um atendente humano assumiu parte desta conversa; retome com consciência disso — para encerrar, fazer follow-up ou reengajar").
- **Gatilhos de reengajamento** (cron, idempotente, padrão `agents/followup.ts`):
  - **Fora de horário comercial** — mensagem chega fora da janela → IA assume com contexto.
  - **Ocioso** — após N minutos sem atividade humana (default 60min, configurável) → IA reengaja com contexto.
  - **Finalização/wrap-up** — IA pode encerrar/resumir após o humano sair.

---

## 3. Cockpit de atendimento (UI)

- **Painel direito = centro de comando completo** (`ContactInfoPanel`), referência ≥ Chatwoot/Intercom/Kommo: status (resolver/snooze/reabrir), atribuir/pegar/transferir, toggle IA + estado de handoff, contexto (canal, departamento, atendente, estágio), histórico de routing, notas.
- **Header = espelho condicional.** Os atalhos de ação aparecem no header **apenas quando o painel direito está fechado**; ao abrir o painel, o header esconde as ações (zero duplicação) e o painel assume tudo.
- **Filtros de inbox** por departamento / time / atendente, coerentes com a política de visibilidade.

---

## 4. Distribuição (auto-assign)

No inbound, ao garantir a conversa, se ela não tem owner e o time-alvo tem estratégia ≠ `manual`:

- `round_robin` — próximo membro ativo do time, em rodízio.
- `least_busy` — membro do time com menos conversas abertas atribuídas.
- `manual` — não atribui (entra na fila do time/dept).

Toda atribuição automática grava `routing_history` (`action='auto_assign'`) e emite `conversation:assigned`.

---

## 5. Permissões novas (adicionar em `packages/shared/src/permissions.ts`)

| Permission | Roles |
|---|---|
| `conversation.resolve` | OWNER, ADMIN, SUPERVISOR, AGENT (das suas) |
| `conversation.snooze` | OWNER, ADMIN, SUPERVISOR, AGENT (das suas) |
| `conversation.ai_mode` | OWNER, ADMIN, SUPERVISOR, AGENT (das suas) — `PERMISSIONS.md §2.1` |
| `inbox.visibility.manage` | OWNER, ADMIN |

---

## 6. Decisões travadas (com o fundador, 2026-06-13)

1. Header = espelho condicional do painel direito.
2. Visibilidade entre escopos = default por role + override por membro.
3. Privacidade entre colegas = default workspace + override por time; lead sempre vê tudo.
4. Time opcional; dept agrupa; resolução `team.peer_visibility ?? workspace.default_peer_visibility`.
5. IA handoff = auto-pausa + retomada consciente de contexto + gatilhos (fora de horário / ocioso ~60min / wrap-up).
6. Escopo da 1ª leva = Ondas A (cockpit) + B (IA on/off) + C (distribuição/visibilidade). D (pipeline no chat) e E (respostas salvas) deferidas.
