# Feature — CAMPAIGNS

> **Domínio:** Campanhas via canais Meta (broadcast, drip, triggered) com compliance LGPD + Meta
> **Pacotes:** `apps/api/src/routes/campaigns`, `apps/workers/campaigns`, `apps/web/src/features/campaigns`
> **Provider:** WhatsApp Cloud é o canal completo no MVP; Instagram entra na fase F1.5 com restrições próprias (sem HSM, uso de `MESSAGE_TAG`). WAHA cobre disparos não-oficiais.

---

## 1. Conceito

Campaign envia mensagens em massa ou em cadência para uma lista de contatos. Tem regras estritas de compliance:

- **Templates Meta** devem estar APPROVED antes do envio.
- **Categoria MARKETING** exige opt-in explícito por contato.
- **Janela de envio** respeitada (timezone do workspace).
- **Quality rating Meta** monitorado em tempo real; campanha pausa em RED.
- **Rate limit** adaptativo + limite diário.

---

## 2. Tipos

| Tipo | Descrição | Exemplo |
|---|---|---|
| `broadcast` | Disparo único pra lista | Comunicado oferta Black Friday |
| `drip` | Sequência de N steps com delays | Onboarding pós-cadastro: dia 0, dia 3, dia 7 |
| `triggered` | Dispara individualmente quando evento ocorre | Carrinho abandonado, novo lead |

---

## 3. Modelo de dados (resumo, completo em DATA_MODEL.md §11)

- `campaigns` (status DRAFT/SCHEDULED/RUNNING/PAUSED/COMPLETED/CANCELLED)
- `campaign_steps` (template + delay + stop_on_reply)
- `campaign_recipients` (contact + status)
- `campaign_deliveries` (per-message; com idempotency key)
- `campaign_metrics` (rolling snapshot)
- `campaign_followups`

---

## 4. Fluxo de criação

```
1. User → CampaignEditor (multi-step wizard)
   ├─ Step 1: Nome, tipo, canal, agendamento
   ├─ Step 2: Recipients (upload CSV, segmentação, ou seleção manual)
   ├─ Step 3: Steps (template Meta + delay)
   ├─ Step 4: Send windows + rate limit
   ├─ Step 5: Configurações IA (auto handoff on reply)
   └─ Step 6: Review + ativar

2. POST /api/campaigns → status='draft'
3. POST /api/campaigns/:id/validate → retorna { safe, critical_issues[], warnings[] }
4. POST /api/campaigns/:id/activate → status='scheduled' ou 'running'
   ↓
   Worker-campaigns pega
```

---

## 5. Validação pré-ativação (`/validate`)

Replica regras do v1 (`docs/features/CAMPAIGN_VALIDATION_REQUIREMENTS.md`):

```ts
async function validateCampaign(campaignId: string): Promise<ValidationResult> {
  const result = { safe: true, criticalIssues: [], warnings: [], stats: {} };

  const campaign = await loadCampaign(campaignId);

  // 1. Steps existem
  if (campaign.steps.length === 0) result.criticalIssues.push('Nenhum step configurado');

  // 2. Templates approved
  for (const step of campaign.steps) {
    const template = await fetchMetaTemplate(campaign.channelId, step.templateName);
    if (template.status !== 'APPROVED') {
      result.criticalIssues.push(`Template ${step.templateName} não está APROVADO`);
    }
    if (template.category === 'MARKETING') {
      // 3. Opt-in obrigatório para todos os recipients
      const noOptIn = await db.campaignRecipients.count({
        where: and(
          eq(campaignRecipients.campaignId, campaignId),
          // join com contacts onde marketing_opt_in=false
        ),
      });
      if (noOptIn > 0) {
        result.criticalIssues.push(`${noOptIn} recipients sem opt-in para MARKETING`);
      }
    }
  }

  // 4. Canal ativo + quality rating
  const channelHealth = await fetchChannelQuality(campaign.channelId);
  if (channelHealth.qualityRating === 'RED') result.criticalIssues.push('Quality rating RED — canal está bloqueado');
  if (channelHealth.qualityRating === 'YELLOW') result.warnings.push('Quality rating YELLOW — risco moderado');

  // 5. Tier Meta suporta volume
  const recipientCount = await db.campaignRecipients.count({ where: eq(campaignRecipients.campaignId, campaignId) });
  if (recipientCount > channelHealth.tierLimit) {
    result.criticalIssues.push(`Recipients (${recipientCount}) excede tier limit (${channelHealth.tierLimit})`);
  }

  // 6. Send windows configurada?
  if (!campaign.sendWindows?.enabled) result.warnings.push('Send windows não configurada — envia 24/7');

  // 7. Rate limit conservador?
  if (campaign.rateLimitPerMinute > 60) result.warnings.push('Rate limit alto — risco de YELLOW');

  result.safe = result.criticalIssues.length === 0;
  return result;
}
```

UI mostra checklist; só permite ativar se `safe=true`.

---

## 6. Send windows

```ts
type SendWindows = {
  enabled: boolean;
  timezone: string;             // ex: 'America/Sao_Paulo'
  windows: Array<{
    day: 0|1|2|3|4|5|6;          // 0=Domingo
    start: string;               // 'HH:MM' 24h
    end: string;
  }>;
};
```

Antes de enviar uma mensagem (no worker-campaigns ou no worker-outbound consumidor da campanha), check:

```ts
function isInSendWindow(windows: SendWindows, now: Date, contactTimezone?: string): boolean {
  if (!windows.enabled) return true;
  const tz = contactTimezone ?? windows.timezone;
  const localNow = zonedTimeToUtc(now, tz);
  const day = localNow.getDay();
  const hhmm = format(localNow, 'HH:mm');

  return windows.windows.some(w => w.day === day && w.start <= hhmm && hhmm < w.end);
}
```

Se fora: agenda re-tentativa pro início da próxima janela. Não tenta enviar fora.

---

## 7. Rate limit adaptativo

```ts
// Calcula real rate baseado em quality
async function effectiveRatePerMinute(campaign: Campaign, channelHealth: ChannelHealth): Promise<number> {
  let rate = campaign.rateLimitPerMinute;
  if (channelHealth.qualityRating === 'YELLOW') rate = Math.floor(rate * 0.5);
  if (channelHealth.qualityRating === 'RED') {
    // pausa imediatamente
    await pauseCampaign(campaign.id, 'quality_red');
    return 0;
  }
  // throttle se delivery rate caindo
  if (campaign.metrics.deliveryRate < 0.85) rate = Math.floor(rate * 0.7);
  return rate;
}
```

---

## 8. Worker-campaigns

### 8.1 Tick (cron 1min via scheduler)

```ts
async function campaignTick() {
  const running = await db.campaigns.findMany({
    where: and(
      eq(campaigns.status, 'running'),
      or(isNull(campaigns.nextTickAt), lte(campaigns.nextTickAt, new Date())),
    ),
  });

  for (const c of running) {
    await runWithDistributedLock(`hm:lock:campaign:${c.id}`, 50_000, async () => {
      await processCampaignTick(c);
    });
  }
}

async function processCampaignTick(campaign: Campaign) {
  const channelHealth = await fetchChannelQuality(campaign.channelId);
  const rate = await effectiveRatePerMinute(campaign, channelHealth);
  if (rate === 0) return;

  if (!isInSendWindow(campaign.sendWindows, new Date())) {
    await scheduleNextTick(campaign, nextWindowStart(campaign.sendWindows));
    return;
  }

  // pega N recipients pendentes (N = rate / 4, pra distribuir em 15s)
  const batch = await db.campaignRecipients.findMany({
    where: and(
      eq(campaignRecipients.campaignId, campaign.id),
      eq(campaignRecipients.status, 'pending'),
    ),
    limit: Math.floor(rate / 4),
  });

  for (const r of batch) {
    await dispatchCampaignDelivery(campaign, r);
    await sleep(60_000 / rate + Math.random() * 200);  // jitter
  }

  await scheduleNextTick(campaign, addMinutes(new Date(), 1));
}
```

### 8.2 Dispatch delivery (idempotente)

```ts
async function dispatchCampaignDelivery(campaign: Campaign, recipient: CampaignRecipient) {
  const nextStepIdx = recipient.lastStepIndex + 1;
  const step = campaign.steps[nextStepIdx];
  if (!step) {
    // recipient completou
    await db.campaignRecipients.update({ where: { id: recipient.id }, set: { status: 'completed' } });
    return;
  }

  const idempotencyKey = sha256(`${campaign.id}:${recipient.id}:${step.id}`);

  // cria delivery (UNIQUE em idempotency_key)
  const existing = await db.campaignDeliveries.findFirst({ where: eq(campaignDeliveries.idempotencyKey, idempotencyKey) });
  if (existing) return;  // já dispatched

  const [delivery] = await db.campaignDeliveries.insert({ ... }).returning();

  // publish outbound request
  await publishApp({
    type: 'outbound.request',
    workspaceId: campaign.workspaceId,
    correlationId: delivery.id,
    payload: {
      kind: 'template',
      contactId: recipient.contactId,
      channelId: campaign.channelId,
      templateName: step.templateName,
      languageCode: step.languageCode,
      components: step.templateComponents,
      metadata: { campaignId: campaign.id, deliveryId: delivery.id },
    },
  });
}
```

### 8.3 Resposta do contato

Worker-inbound, ao processar mensagem inbound, verifica se há campanha relacionada:

```ts
async function handleContactReply(message: Message, conversation: Conversation) {
  // recente delivery dessa conv?
  const recentDelivery = await db.campaignDeliveries.findFirst({
    where: and(
      eq(campaignDeliveries.workspaceId, message.workspaceId),
      // join via conversation -> contact -> campaign_recipients
      // dentro das últimas 7 dias
    ),
    orderBy: desc(campaignDeliveries.sentAt),
  });

  if (recentDelivery) {
    // mark recipient as responded
    await db.campaignRecipients.update({
      where: { id: recentDelivery.recipientId },
      set: { responded: true, respondedAt: new Date(), status: 'responded' },
    });

    const campaign = await db.campaigns.findFirst({ where: eq(campaigns.id, recentDelivery.campaignId) });
    if (campaign.autoHandoffOnReply && campaign.aiHandoffAgentId) {
      await db.conversations.update({
        where: { id: conversation.id },
        set: { aiMode: 'on', agentId: campaign.aiHandoffAgentId },
      });
    }

    // dispatch followup
    if (campaign.followups.some(f => f.triggerEvent === 'on_reply')) {
      await publishApp({ type: 'campaign.followup', payload: { campaignId: campaign.id, recipientId: recentDelivery.recipientId, event: 'on_reply' } });
    }
  }
}
```

### 8.4 Followup processor

```ts
async function processCampaignFollowup(envelope: Envelope<FollowupEvent>) {
  const { campaignId, recipientId, event } = envelope.payload;

  const followup = await db.campaignFollowups.findFirst({
    where: and(eq(campaignFollowups.campaignId, campaignId), eq(campaignFollowups.triggerEvent, event), eq(campaignFollowups.isActive, true)),
    orderBy: asc(campaignFollowups.position),
  });
  if (!followup) return;

  const scheduledAt = addMinutes(new Date(), followup.delayMinutes);
  await schedulePersistedFollowup({ campaignId, recipientId, followupId: followup.id, scheduledAt });
  // tabela auxiliar `scheduled_followups` para sobreviver crash; tick processa
}
```

(Usa tabela persistente em vez de setTimeout do v1 — sobrevive crashes.)

---

## 9. Opt-in / opt-out LGPD

### 9.1 Registro

API:

```http
POST /api/contacts/:id/opt-in
{
  "method": "whatsapp" | "website" | "checkout" | "import" | "manual" | "api",
  "source": "Black Friday Landing 2025"
}
```

Atualiza `contacts.marketing_opt_in=true`, `opt_in_method`, `opt_in_source`, `opt_in_at=now()`.

### 9.2 Bulk

```http
POST /api/contacts/bulk-opt-in
{
  "contactIds": ["uuid1", ...],
  "method": "import",
  "source": "Lista importada 2026-06-06"
}
```

### 9.3 Opt-out automático (keywords)

Worker-inbound, ao receber mensagem text:

```ts
const OPT_OUT_KEYWORDS = ['STOP','PARAR','SAIR','CANCELAR','REMOVER','DESCADASTRAR'];

function isOptOutKeyword(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.includes(normalized);
}

if (isOptOutKeyword(message.content ?? '')) {
  await optOutContact(contact.id, { reason: 'KEYWORD_STOP', via: 'whatsapp' });
  // remove de todas campanhas MARKETING futuras
  // envia confirmação automática
}
```

### 9.4 Painel "Histórico de consentimento"

Para cada contato, UI mostra:
- Opt-in: quando, por qual fonte
- Opt-out: quando, motivo
- Audit log

---

## 10. Meta error codes

Mapeamento + ação:

| Código | Significado | Ação |
|---|---|---|
| `130472` | Rate limit exceeded | Pausa 5min; retoma |
| `131026` | Fora da janela 24h | Marca recipient invalido; só template MARKETING/UTILITY a partir daí |
| `131047` | Re-engagement required | Marca recipient como "needs re-engagement" |
| `131051` | Message undeliverable (bloqueado) | Incrementa block counter; pausa se > 5% |
| `131008` | Required parameter missing | Log + fail delivery |
| `132001` | Template paused/disabled | Pausa campanha; alerta admin |

Tabela em `packages/channels/src/meta/errors.ts`.

---

## 11. Métricas em real-time

Tabela `campaign_metrics` atualizada por trigger ou by job:

- `delivery_rate = delivered / sent`
- `read_rate = read / delivered`
- `response_rate = replied / sent`
- `block_rate = blocked / sent`
- `failure_rate = failed / sent`
- `health_status`:
  - `healthy` se delivery_rate >= 0.85 e block_rate < 0.02
  - `warning` se delivery_rate < 0.85 ou block_rate < 0.05
  - `critical` se delivery_rate < 0.70 ou block_rate >= 0.05

UI dashboard mostra real-time com refetch 30s.

---

## 12. UI (frontend)

### 12.1 CampaignsPage

- Lista campanhas com filtro por status.
- Cards com KPIs (recipients, sent, delivered, replied, rate visual).
- Action buttons: pausar, retomar, cancelar, duplicar.

### 12.2 CampaignEditor (wizard)

5-6 steps com progresso visual. RHF + Zod com validation per step.

### 12.3 Recipients import

- CSV upload com mapping de colunas.
- Preview primeiras 10 linhas.
- Validação: phones válidos E.164.
- Duplicate detection (mesmo phone → reusa contact existente).
- Opt-in batch on import (com source).

### 12.4 Template picker

- Lista templates aprovados Meta do canal.
- Filtro por categoria.
- Preview com componentes renderizados.
- Variáveis `{{1}}`, `{{2}}` mapeadas pra fields do contact (name, custom_fields.X).

### 12.5 Send windows editor

- Visual grid 7 dias × 24h.
- Click + drag para selecionar janela.
- Quick options: "Horário comercial (Seg-Sex 9-18)", "Todo dia 9-21", "24/7".

### 12.6 Real-time monitoring

Painel em campaign details:
- Big stats (sent, delivered, replied).
- Trend chart (5min granularity).
- Health status badge.
- Alerts panel (Meta errors recentes).
- Botão "Pausar campanha".

---

## 13. API

| Método | Path | Descrição |
|---|---|---|
| GET | `/api/campaigns` | Lista |
| POST | `/api/campaigns` | Cria draft |
| GET | `/api/campaigns/:id` | Detalhe |
| PUT | `/api/campaigns/:id` | Update |
| DELETE | `/api/campaigns/:id` | Cancel + cleanup |
| POST | `/api/campaigns/:id/validate` | Pre-flight |
| POST | `/api/campaigns/:id/activate` | Start |
| POST | `/api/campaigns/:id/pause` | Pause |
| POST | `/api/campaigns/:id/resume` | Resume |
| POST | `/api/campaigns/:id/recipients/bulk` | Upload CSV |
| POST | `/api/campaigns/:id/recipients/bulk-opt-in` | Bulk opt-in |
| GET | `/api/campaigns/:id/metrics` | Métricas atual |
| GET | `/api/campaigns/:id/deliveries` | Lista deliveries |
| POST | `/api/contacts/:id/opt-in` | Registra opt-in |
| POST | `/api/contacts/:id/opt-out` | Registra opt-out |

---

## 14. Métricas operacionais

- Send rate observado vs configurado < 10% diff.
- Block rate por workspace < 2% (alert se > 5%).
- DLQ deliveries < 1% das deliveries dispatched.
- Followup latency: scheduled_at → sent_at < 30s.

---

## 15. Não-objetivos MVP

- A/B testing de templates: fase 2.
- Custom segments com filtros complexos: fase 2 (MVP só lista upload).
- **Campanhas via Instagram completas**: fase F1.5 (após adapter IG estar implementado). Schema já permite `channel.provider='meta_instagram'`, mas a regra de envio é diferente — vide §17.
- Suporte a Email/Telegram: fase 2.
- Anti-spam ML: fase 2 (regras heurísticas no MVP).
- Drag-drop visual de cadência drip com canvas: fase 2 (MVP usa lista linear).

---

## 17. Campanhas em Instagram (preparação schema-ready, implementação F1.5)

### 17.1 Diferenças críticas vs WhatsApp

| Aspecto | WhatsApp Cloud | Instagram Messaging |
|---|---|---|
| Templates HSM aprovados pela Meta | ✅ Obrigatório para outbound proativo | ❌ **Não existe** |
| Outbound proativo fora da janela 24h | Só HSM categorias MARKETING/UTILITY/AUTHENTICATION | `MESSAGE_TAG: HUMAN_AGENT` (até 7d da última interação) ou outros tags com contexto válido |
| Outbound proativo sem histórico (cold) | Proibido pela política Meta + LGPD | **Proibido pela API** Meta IG (rejeita) |
| Categoria MARKETING | Texto longo permitido com opt-in registrado | Quebra ToS Meta IG; não permitido |
| Rate limit | Tier-based (250/1k/10k/100k msgs/dia escalonado por quality) | Mensagens/segundo limitado por conta + soft cap por janela |
| Block rate alvo | < 2% | Não exposto pela Meta; monitorar manualmente |

### 17.2 Validation extra para `channel.provider='meta_instagram'`

`/validate` aplica regras adicionais:

1. **Sem `template_name`** — step usa `text` ou `interactive` (quick_replies / generic_template / button_template).
2. **Recipients sem interação prévia bloqueados** — query: `campaign_recipients JOIN conversations WHERE channel_id = X AND contact_id IN (...)`. Recipients sem conversa inbound nunca = `criticalIssues.push('IG: <N> recipients sem interação prévia (proibido pela Meta)')`.
3. **`message_tag` exigido se step pode cair fora da janela 24h.** UI campaign editor mostra tag picker com tooltip explicando uso responsável.
4. **Block rate threshold** menor — alerta em > 1% (vs > 2% WA).

### 17.3 UX

- Wizard mostra **tabs por provider** quando workspace tem ambos: "WhatsApp" e "Instagram".
- Em Instagram, step 3 (templates) vira "Mensagem direta" com editor de texto + interactive picker.
- Step 6 (review) inclui aviso destacado: *"Instagram não tem templates Meta. Mensagens são enviadas como DM padrão dentro da janela 24h, ou com Human Agent Tag se fora dela. Uso indevido pode reduzir reach orgânico ou bloquear permission."*

---

## 16. Riscos

- **Banimento WABA por compliance:** mitigation = validation rigorosa + monitoramento quality.
- **Falsos positivos opt-out (cliente escreve "PARAR" sem intenção):** mitigation = confirmação automática "Confirma que quer parar?".
- **Race em quem responde a delivery:** mitigation = lookup janela 7 dias + idempotency.
