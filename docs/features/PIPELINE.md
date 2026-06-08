# Feature — PIPELINE (Funil unificado)

> **Domínio:** Pipeline / funil de vendas/atendimento. Substitui a dupla estrutura do v1 (`kanban_columns` legacy + `project_stages`).
> **Pacotes:** `apps/api/src/routes/pipeline`, `apps/web/src/features/pipeline`, `packages/flow-engine` (integration)

---

## 1. Conceito

Workspace tem N pipelines (por padrão um "Vendas"). Cada pipeline tem N stages ordenadas. Cards (deals) avançam entre stages.

**Diferenças centrais do v1:**

- **Estrutura única:** `pipelines + stages + deals` (resolve dupla estrutura).
- **Automação por stage:** `stages.automation_rules` JSONB define triggers (on_enter, on_exit, on_stale) que disparam ações (trigger_flow, send_message, notify_members, etc).
- **Transition rules:** `stages.transition_rules` define que campos custom precisam estar preenchidos, que roles podem mover, se requer aprovação.
- **Event sourcing:** `deal_history` rastreia tudo (criação, mudança de stage, edição de campo, owner change, fechamento).
- **Real-time sync:** drag-and-drop entre membros via Socket.IO.
- **Mídia integrada:** `deal_attachments` com EXIF/GPS (mantém componente CardImageCapture do v1).
- **Sub-tasks:** `deal_tasks` substitui módulo separado no MVP.
- **Link com conversation:** `deal.conversation_id` permite abrir conversa direto do card.

---

## 2. Modelo de dados (resumo, completo em DATA_MODEL.md §10)

- `pipelines` — N por workspace, com `is_default`.
- `stages` — pertence a pipeline, ordenada por `position`, com `automation_rules` JSONB e `transition_rules` JSONB.
- `deals` — card; FK contact obrigatório, conversation opcional, owner_member opcional, value_cents.
- `deal_history` — event-sourced audit log.
- `deal_attachments` — mídia com metadata EXIF/GPS.
- `deal_tasks` — checklist do card.

---

## 3. Stage automation rules

### 3.1 Schema

```ts
type AutomationRule = {
  id: string;
  trigger: 'on_enter' | 'on_exit' | 'on_stale';
  staleAfterDays?: number;                // se trigger = on_stale
  action: 'trigger_flow' | 'send_message' | 'notify_members' | 'create_event' | 'add_tag' | 'remove_tag';
  config:
    | { kind: 'trigger_flow'; flowId: string }
    | { kind: 'send_message'; templateName: string; languageCode: string; channelId: string }
    | { kind: 'notify_members'; memberIds: string[]; title: string; body: string }
    | { kind: 'create_event'; calendarId: string; title: string; durationMinutes: number; offsetDays: number }
    | { kind: 'add_tag'; tagId: string }
    | { kind: 'remove_tag'; tagId: string };
  delaySeconds: number;
  enabled: boolean;
};
```

### 3.2 Disparo

Quando `deal.stage_id` muda:

```ts
async function moveDealToStage(dealId: string, newStageId: string, actor: Actor) {
  const oldDeal = await loadDeal(dealId);
  const oldStage = await loadStage(oldDeal.stageId);
  const newStage = await loadStage(newStageId);

  // 1. validate transition (ver §4)
  validateTransition({ from: oldStage, to: newStage, deal: oldDeal, actor });

  // 2. update
  await db.deals.update({ where: { id: dealId }, set: { stageId: newStageId, position: 0 } });

  // 3. insert history
  await db.dealHistory.insert({
    dealId,
    workspaceId: oldDeal.workspaceId,
    eventType: 'stage_changed',
    fromValue: { stageId: oldDeal.stageId },
    toValue: { stageId: newStageId },
    actorMemberId: actor.memberId,
    actorType: actor.type,
  });

  // 4. dispatch automations on_exit do stage antigo + on_enter do novo
  await dispatchAutomationRules(oldStage.automationRules, 'on_exit', { dealId, oldStage, newStage });
  await dispatchAutomationRules(newStage.automationRules, 'on_enter', { dealId, oldStage, newStage });

  // 5. emit socket pra real-time UI
  await publishSocketEvent('deal:stage_changed', { workspaceId: oldDeal.workspaceId, dealId, fromStageId: oldDeal.stageId, toStageId: newStageId });
}

async function dispatchAutomationRules(rules: AutomationRule[], trigger: string, ctx: AutomationContext) {
  for (const rule of rules.filter(r => r.trigger === trigger && r.enabled)) {
    await scheduleAutomationAction(rule, ctx);  // adiciona delay configurado + persiste em tabela `pending_automations` pra sobreviver crash
  }
}
```

### 3.3 Scheduler de automations

Worker (campaigns reaproveitado ou um worker-automations dedicado) processa `pending_automations` table:

```ts
async function processPendingAutomations() {
  const due = await db.pendingAutomations.findMany({ where: lte(pendingAutomations.scheduledAt, new Date()), limit: 50 });
  for (const item of due) {
    try {
      await executeAutomationAction(item);
      await db.pendingAutomations.delete({ where: { id: item.id } });
    } catch (err) {
      // retry policy
      await db.pendingAutomations.update({ where: { id: item.id }, set: { attempts: item.attempts + 1, lastError: String(err) } });
      if (item.attempts >= 3) {
        await db.pendingAutomations.update({ where: { id: item.id }, set: { status: 'failed' } });
      }
    }
  }
}
```

### 3.4 Trigger `on_stale`

Cron diário verifica `deals` que estão em stage com regra `on_stale` por > N dias:

```sql
SELECT d.id, d.stage_id, s.automation_rules
FROM deals d
JOIN stages s ON s.id = d.stage_id
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(s.automation_rules) AS rule
  WHERE rule->>'trigger' = 'on_stale'
    AND rule->>'enabled' = 'true'
)
AND d.updated_at < NOW() - INTERVAL '<days>' * 1
```

(SQL ilustrativo; refatorar com expressões de array.)

---

## 4. Transition rules

### 4.1 Schema

```ts
type TransitionRules = {
  allowedFromStageIds: string[];          // vazio = qualquer
  requiredFields: string[];                // keys de custom_fields que devem ter valor
  requiredRoles: Array<'OWNER'|'ADMIN'|'SUPERVISOR'|'AGENT'>;  // vazio = qualquer
  requiresApproval: boolean;               // ainda fora do MVP scope
};
```

### 4.2 Validação

```ts
function validateTransition(input: { from: Stage; to: Stage; deal: Deal; actor: Actor }) {
  const rules = input.to.transitionRules ?? {};

  if (rules.allowedFromStageIds?.length > 0 && !rules.allowedFromStageIds.includes(input.from.id)) {
    throw new TransitionError(`Não é permitido mover deste stage para ${input.to.name}`);
  }

  for (const fieldKey of rules.requiredFields ?? []) {
    if (!input.deal.customFields?.[fieldKey]) {
      throw new TransitionError(`Campo obrigatório ausente: ${fieldKey}`);
    }
  }

  if (rules.requiredRoles?.length > 0 && !rules.requiredRoles.includes(actor.role)) {
    throw new TransitionError(`Apenas ${rules.requiredRoles.join('/')} pode mover para ${input.to.name}`);
  }
}
```

UI mostra warnings antes da drag-drop ser permitida (validação cliente-side + server-side).

### 4.3 Aprovações

`requiresApproval` no MVP é flag mas sem fluxo completo. Quando true e usuário tenta mover:
- Cria `pending_approval` (table futura) com `from_stage`, `to_stage`, `deal_id`, `requested_by`, `status='pending'`.
- Notifica owners/admins.
- Approver aprova → executa moveDealToStage.

(Pode ser cortado no MVP estrito; depende da prioridade.)

---

## 5. Mídia em deals

### 5.1 CardImageCapture (frontend, mantém do v1)

- Usa `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` para câmera traseira em mobile.
- Captura via Canvas.
- Opcional GPS via `useGeolocation` (hook v1 mantido).
- Overlay textual com timestamp, lat/lon, address, city.

### 5.2 Upload

Pipeline:
1. Frontend solicita signed URL: `POST /api/uploads/signed-url` retorna URL R2 + key.
2. Browser upload direto para R2.
3. Frontend chama `POST /api/deals/:id/attachments` com `{ storageKey, mime, size, sha256, gpsLat, gpsLon, gpsAltitude, gpsAccuracy, capturedAt, indexNumber, metadata: { city, state, address, country } }`.
4. Backend valida ownership (workspace_id), insere em `deal_attachments`.

### 5.3 Versionamento

Cada upload mesmo arquivo (sha256 idêntico) incrementa `version`. UI mostra histórico.

### 5.4 Display

`CardImageGallery` (mantém do v1) com carrossel + metadata overlay + delete por item.

---

## 6. Real-time sync (NOVO no v2)

### 6.1 Socket events

```ts
type ServerToClient = {
  'deal:created': (p: { workspaceId: string; deal: Deal }) => void;
  'deal:updated': (p: { workspaceId: string; deal: Deal }) => void;
  'deal:stage_changed': (p: { workspaceId: string; dealId: string; fromStageId: string; toStageId: string; movedBy: string }) => void;
  'deal:deleted': (p: { workspaceId: string; dealId: string }) => void;
  'pipeline:updated': (p: { workspaceId: string; pipelineId: string }) => void;
};
```

### 6.2 Frontend optimistic + reconciliation

```ts
// drag-and-drop handler
async function onDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  const dealId = active.id as string;
  const newStageId = over?.data?.current?.stageId;
  if (!newStageId) return;

  // optimistic update local
  qc.setQueryData(['deals', pipelineId], (old: Deal[]) =>
    old.map(d => d.id === dealId ? { ...d, stageId: newStageId } : d)
  );

  try {
    await api.deals.moveStage(dealId, newStageId);
    // socket vai chegar com confirmação; TanStack invalidate se preciso
  } catch (err) {
    // revert
    qc.invalidateQueries({ queryKey: ['deals', pipelineId] });
    toast.error(err.message);
  }
}

// socket listener
useSocketEvent('deal:stage_changed', (p) => {
  if (p.workspaceId !== currentWs) return;
  qc.invalidateQueries({ queryKey: ['deals', pipelineId] });
});
```

---

## 7. Tasks no deal (`deal_tasks`)

Substitui módulo separado de tasks no MVP.

### 7.1 UI

- Sub-section do card detail panel.
- Checklist com checkbox.
- Cada task: title, due_at, assigned_to (member), priority.
- Quick add em uma linha.

### 7.2 Endpoints

```
GET    /api/deals/:id/tasks
POST   /api/deals/:id/tasks
PUT    /api/deals/:id/tasks/:taskId
DELETE /api/deals/:id/tasks/:taskId
POST   /api/deals/:id/tasks/:taskId/complete
```

### 7.3 Notificações

- Task com `due_at` próximo (cron 1h) → notification para assigned_to + email opcional.
- Task overdue → notification badge no sidebar.

---

## 8. Custom fields

### 8.1 Definição

Workspace define schemas de custom fields por pipeline (talvez por stage também). Schema simplificado:

```ts
type CustomFieldDef = {
  key: string;             // ex: 'budget_brl'
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'currency';
  required: boolean;
  options?: string[];      // se select/multiselect
  defaultValue?: any;
  position: number;
};
```

Persistido em `pipelines.settings.custom_fields[]`. (Ou tabela dedicada se ficar grande.)

### 8.2 Storage

Valores em `deals.custom_fields` JSONB. Validação Zod na inserção via schema dinâmico construído do CustomFieldDef.

### 8.3 UI

- Settings → Pipeline → Custom fields: edit list (drag reorder).
- Card form: renderiza fields dinamicamente.
- Inspector do card: mostra fields agrupados.

---

## 9. UI

### 9.1 PipelinePage

Layout kanban horizontal:

```
┌─────────────────────────────────────────────────────────┐
│ [Pipeline selector] [Filters: owner, tag, date] [+ Deal]│
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Stage 1  │ Stage 2  │ Stage 3  │ Stage 4  │ Stage 5     │
│ (5)      │ (12)     │ (3)      │ (8)      │ (2)         │
│          │          │          │          │             │
│ [Card]   │ [Card]   │ [Card]   │ [Card]   │ [Card]      │
│ [Card]   │ [Card]   │ [Card]   │ [Card]   │ [Card]      │
│ ...      │ ...      │          │ ...      │             │
└──────────┴──────────┴──────────┴──────────┴─────────────┘
```

dnd-kit horizontal sortable para stages (reorder); vertical sortable per stage para cards.

### 9.2 Card

```
┌─────────────────────────────┐
│ [tag] [tag]                 │
│ Título do deal              │
│ R$ 12.500                   │
│ ─                           │
│ Contato: Fulano             │
│ Owner: Avatar João          │
│ Source: Landing             │
│ [3 tasks] [2 anexos]        │
└─────────────────────────────┘
```

Hover: lift + shadow. Drag: opacity 0.5.

### 9.3 DealDetailDrawer

Slide-in drawer ao clicar no card. Sections:
- Header (título, valor, stage, status)
- Contact summary
- Tasks
- Notes
- History timeline (deal_history)
- Attachments (gallery)
- Custom fields
- Conversation link (se associada)

### 9.4 PipelineSettingsPage

- List stages com drag reorder
- Cada stage: edit name, color, position, automation_rules, transition_rules
- Add stage
- Delete stage (com confirm e re-distribuição de deals)

---

## 10. API

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/pipelines` | Lista |
| POST | `/api/pipelines` | Cria |
| GET | `/api/pipelines/:id` | Detalhe + stages |
| PUT | `/api/pipelines/:id` | Update |
| DELETE | `/api/pipelines/:id` | Remove (CASCADE em stages + deals) |
| POST | `/api/pipelines/:id/stages` | Cria stage |
| PUT | `/api/stages/:id` | Update stage |
| DELETE | `/api/stages/:id` | Remove (move deals pra fallback stage) |
| PATCH | `/api/stages/reorder` | Reorder positions |
| GET | `/api/deals?pipelineId=...` | Lista deals filtrados |
| POST | `/api/deals` | Cria |
| GET | `/api/deals/:id` | Detalhe |
| PUT | `/api/deals/:id` | Update (não muda stage) |
| POST | `/api/deals/:id/move-stage` | Move stage (executa validation + history + automation) |
| POST | `/api/deals/:id/close-won` | Fecha como ganho |
| POST | `/api/deals/:id/close-lost` | Fecha como perdido |
| POST | `/api/deals/:id/reopen` | Reabre |
| GET | `/api/deals/:id/history` | Audit log |
| GET | `/api/deals/:id/attachments` | Anexos |
| POST | `/api/deals/:id/attachments` | Adiciona anexo |
| DELETE | `/api/deals/:id/attachments/:attId` | Remove |
| GET | `/api/deals/:id/tasks` | Tasks |
| POST | `/api/deals/:id/tasks` | Cria task |
| PUT | `/api/deals/:id/tasks/:taskId` | Update |
| POST | `/api/deals/:id/tasks/:taskId/complete` | Marca completa |

---

## 11. Integração com agente IA

Tool `move_deal_stage` permite agente IA promover deals automaticamente:

```ts
const schema = z.object({
  dealId: z.string().uuid(),
  toStageId: z.string().uuid(),
  reason: z.string().optional(),
});

export const moveDealStageTool: ToolDefinition<...> = {
  key: 'move_deal_stage',
  name: 'Mover deal de estágio',
  description: 'Move um deal para outro estágio do pipeline.',
  category: 'database',
  config: {
    columnsWritten: ['stage_id'],
    requiredColumns: ['dealId', 'toStageId'],
  },
  async handler(args, ctx) {
    await moveDealToStage(args.dealId, args.toStageId, { type: 'agent', agentId: ctx.agentId });
    return { success: true };
  },
};
```

Agente sales (template seed) tem essa tool habilitada por padrão.

---

## 12. Métricas

- **Conversion rate por stage:** % de deals que passaram pelo stage e chegaram em won.
- **Tempo médio por stage:** average dias entre `stage_changed` events.
- **Velocity:** valor total fechado / mês.
- **Pipeline value:** soma de `value_cents` por stage.

Dashboard com gráficos:
- Funnel chart (visual width proporcional a count por stage).
- Velocity chart (línea temporal de valor fechado).
- Stale deals alert.

---

## 13. Não-objetivos MVP

- Sales forecast com IA: fase 2.
- Pipeline templates por indústria (solar, construção do v1): drop. Concept overkill; usuário define stages livre.
- Project tasks (módulo dedicado): drop; `deal_tasks` cobre.
- Multi-currency: drop; BRL only no MVP. Schema preparado (`currency` column).
- Recurring deals (assinaturas): fase 2.
- Probabilidade ponderada para forecast: pode entrar (`stages.probability` já existe), mas UI fase 2.

---

## 14. Riscos

| Risco | Mitigation |
|---|---|
| Performance com muitos deals (>10k) | Pagination com cursor; `position`-based ordering; virtualized list |
| Race em drag-drop simultâneo entre 2 members | Server-side dispute resolution (último write wins); UI mostra notification se foi sobrescrito |
| Custom fields com valores incompatíveis em mudança de schema | Validation graceful + migrate manual; UI mostra warning em deals inválidos |
| Automation infinita (move stage → automation move stage) | Detect cycles; limit auto-moves per deal per dia |

---

## 15. Próximos passos pós `/hm-init`

1. Schema Drizzle pipeline/stages/deals.
2. CRUD básico de pipeline + drag-drop.
3. Deal detail drawer + tasks + attachments.
4. Automation rules engine (worker + scheduler).
5. Real-time sync via Socket.IO.
6. Integration com flow-engine + agentes.
