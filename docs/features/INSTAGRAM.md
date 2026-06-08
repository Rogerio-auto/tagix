# Feature — INSTAGRAM (Meta Graph API)

> **Domínio:** Integração com Instagram Messaging via Meta Graph API, sob a postura **Tech Provider** da Meta
> **Pacotes:** `packages/channels/meta/instagram/`, `apps/api/src/routes/webhooks/meta.ts`, `apps/workers/{inbound,outbound,media}`, `apps/web/src/features/conversations`
> **Status no MVP:** fundamentos prontos (schema, naming, adapter interface, webhook unificado); implementação completa do adapter Instagram em fase F1.5 (pós-MVP), antes do disparo comercial — vide [`../ROADMAP.md`](../ROADMAP.md)

---

## 1. Por que tratar Instagram em doc dedicado

WhatsApp e Instagram compartilham:

- Mesmo **Meta App** (Highermind como Tech Provider único).
- Mesmo **endpoint de webhook** (`/webhooks/meta`).
- Mesma **infra Graph API** (`https://graph.facebook.com/v23.0/...`).
- Mesma camada de retry/erro/HMAC.

Mas divergem em quase tudo o que importa para o adapter:

| Aspecto | WhatsApp Cloud API | Instagram Messaging |
|---|---|---|
| Objeto do webhook | `whatsapp_business_account` | `instagram` |
| Payload shape | `entry[].changes[].value.messages` | `entry[].messaging[]` (estilo Messenger) |
| Identidade do contato | `wa_id` (MSISDN normalizado) | `igsid` (Instagram-Scoped ID) |
| Identidade do canal | `phone_number_id` + `waba_id` | `ig_user_id` (Instagram Business Account) + `fb_page_id` |
| Token de acesso | System User token via WABA / Cloud API | Page Access Token (system-user de página) |
| Janela 24h | Customer Service Window + templates HSM aprovados | Standard Messaging Window + `MESSAGE_TAG` (HUMAN_AGENT amplia para 7 dias) |
| Mensagens proativas fora da janela | Templates `MARKETING`/`UTILITY`/`AUTHENTICATION` (aprovação Meta obrigatória) | Sem HSM; usa `message_tag` (`HUMAN_AGENT`, `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`) |
| Mídia | text/image/video/audio/voice/document/sticker/location/contact | text/image/video/audio (sem PTT separado)/file; sem sticker; sem location/contact nativos |
| Templates HSM | Sim, com aprovação Meta | **Não existe** — substituído por `ice breakers` + `persistent menu` + `generic templates` em runtime |
| Interactive types | buttons, list, flow, product | quick_replies, generic_template, button_template, list_template (descontinuado), media_template, ice_breakers |
| Eventos extras | reactions, system, status callbacks | **story_mention, story_reply, share, message_reaction, message_seen, message_postback, message_referral** |
| Comments em posts/reels | n/a | Webhook separado (`field: comments`) — necessita Comment Moderation |
| Comment-to-DM (private reply) | n/a | `POST /<IG_USER_ID>/messages` com `recipient: { comment_id }` |
| Read receipts | Status `read` no callback | Evento `messaging_seen` |
| Compliance LGPD/Meta | Opt-in obrigatório para MARKETING | Opt-in implícito (usuário iniciou DM); MARKETING fora da janela 24h proibido em geral |

Essas diferenças justificam **adapter dedicado** (`packages/channels/meta/instagram/`) em paralelo ao WhatsApp, **compartilhando** apenas o cliente HTTP Graph + verificação HMAC.

---

## 2. Postura Tech Provider

Highermind é registrado no Meta App Dashboard como **Tech Provider** habilitado para:

- **WhatsApp Business Platform** (já em produção no v1).
- **Instagram Messaging** (escopo deste documento).

Implicação técnica:

1. **Embedded Signup unificado.** O wizard de conexão de canal (UI em `features/settings/channels/ConnectChannelWizard.tsx`) abre Facebook Login com `scope` combinando `whatsapp_business_management`, `whatsapp_business_messaging`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `business_management`.
2. **System User token único por workspace.** Após signup, geramos System User token na conta Meta do cliente; esse token cobre WA + IG do mesmo Business Account. Armazenado cifrado em `channel_secrets.access_token_enc`.
3. **Webhook único no app.** No Meta App Dashboard, `Webhooks → Configuration` aponta para `https://api.<domínio>/webhooks/meta`. Subscrição em `whatsapp_business_account` (mensagens + status + templates) E `instagram` (messages + messaging_postbacks + messaging_seen + message_reactions + comments + mentions).
4. **App Review.** Para sair de Dev Mode em IG, app review da Meta exigida — checklist em runbook `docs/runbooks/meta-app-review-instagram.md` (criar em F1.5).

---

## 3. Modelo de dados

Schema completo em [`../DATA_MODEL.md`](../DATA_MODEL.md). Resumo do que é específico de IG:

### 3.1 `channels`

```sql
-- provider expandido (vide DATA_MODEL.md §6.1)
provider text NOT NULL CHECK (provider IN ('meta_whatsapp','meta_instagram','waha'))

-- colunas Instagram-specific
ig_user_id           text,            -- Instagram Business Account ID
ig_username          text,            -- @handle display
fb_page_id           text,            -- Facebook Page vinculada
ig_account_type      text CHECK (ig_account_type IN ('business','creator') OR ig_account_type IS NULL),
```

`UNIQUE(ig_user_id)` quando provider = `meta_instagram`.

### 3.2 `conversations`

`kind` expandido:

```sql
kind text NOT NULL DEFAULT 'direct'
  CHECK (kind IN ('direct','group','story_thread','comment_thread'))
```

- `direct` — DM 1:1 (default, WA e IG).
- `group` — group chat (WA; preparado).
- `story_thread` — sequência de respostas/menções a um story específico (IG). `metadata.story_id` aponta para o story.
- `comment_thread` — comentários sob um post/reel (IG). `remote_id` = `media_id` do post; `metadata.parent_comment_id` opcional.

### 3.3 `messages`

`type` expandido para suportar IG:

```sql
type text NOT NULL DEFAULT 'text'
  CHECK (type IN (
    'text','image','video','audio','voice','document','sticker',
    'location','contact','interactive','template','reaction','system',
    -- novos para Instagram
    'story_mention','story_reply','share','comment','comment_reply','ig_postback','referral'
  ))
```

| Tipo novo | Direção | Quando |
|---|---|---|
| `story_mention` | inbound | Usuário marca @workspace em story dele; payload contém URL temporária da mídia do story |
| `story_reply` | inbound | Usuário responde com texto a um story do workspace; `metadata.story_id` e `metadata.story_url` |
| `share` | inbound | Usuário compartilha um post/reel para a conversa |
| `comment` | inbound | Comentário em post/reel do workspace (kind = `comment_thread`) |
| `comment_reply` | outbound | Resposta pública a um comment |
| `ig_postback` | inbound | Click em botão de generic_template / quick_reply |
| `referral` | inbound | Ad-related: `m.me` link, ads click-to-message |

### 3.4 Tabela `ig_comments` (auxiliar, para moderação)

```sql
CREATE TABLE ig_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  external_comment_id text NOT NULL,
  parent_external_id  text,                            -- comment pai (thread)
  media_id        text NOT NULL,                       -- post/reel
  media_kind      text CHECK (media_kind IN ('post','reel','story')),
  from_ig_user_id text NOT NULL,                       -- IGSID do autor
  from_username   text,
  text            text,
  hidden          boolean NOT NULL DEFAULT false,      -- moderação (POST /comments/{id} hide)
  private_reply_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  raw_payload     jsonb NOT NULL,
  UNIQUE (channel_id, external_comment_id)
);
CREATE INDEX idx_ig_comments_media ON ig_comments(channel_id, media_id, created_at DESC);
CREATE INDEX idx_ig_comments_conversation ON ig_comments(conversation_id) WHERE conversation_id IS NOT NULL;
```

Cada comentário entra em uma `conversation` com `kind='comment_thread'` (uma por `media_id` por contato), permitindo o agente IA / member responder publicamente OU privadamente (comment-to-DM, gera nova `conversation` `kind='direct'`).

### 3.5 `webhook_events`

Mesma tabela, mas `provider` agora pode ser `meta_whatsapp`, `meta_instagram`. `event_uid` continua único por (channel_id, event_uid).

---

## 4. Webhook unificado `/webhooks/meta`

### 4.1 Verify (GET)

Endpoint público que valida `hub.mode=subscribe` + `hub.verify_token` (vem do app, não do channel). Único para WA + IG.

### 4.2 Receive (POST)

```ts
// apps/api/src/routes/webhooks/meta.ts
router.post('/webhooks/meta', verifyMetaSignature, async (req, res) => {
  const body = req.body as MetaWebhookEnvelope;

  // Despacho por object
  switch (body.object) {
    case 'whatsapp_business_account':
      await publishChannels({ type: 'inbound.message', provider: 'meta_whatsapp', payload: body });
      break;
    case 'instagram':
      await publishChannels({ type: 'inbound.message', provider: 'meta_instagram', payload: body });
      break;
    default:
      logger.warn({ object: body.object }, 'webhook.unknown_object');
  }
  res.sendStatus(200);  // Meta exige resposta < 5s
});
```

### 4.3 Signature

`x-hub-signature-256: sha256=<hmac>` calculado com **app_secret** (não com channel_secret). Verificado antes de parse. Mesma função para WA + IG.

### 4.4 Dedup

`webhook_events.event_uid`:
- WA: `wamid` da mensagem.
- IG DM: `messaging[i].message.mid`.
- IG comment: `value.id` do comment.
- IG story mention: `messaging[i].message.mid` (Instagram gera mid).

---

## 5. Adapter Instagram

### 5.1 Estrutura de pacote

```
packages/channels/
├── src/
│   ├── types.ts                       # IChannelAdapter, InboundEvent, SendInput, SendResult
│   ├── shared/
│   │   ├── graphClient.ts             # axios + retry + error mapping comuns WA+IG
│   │   ├── hmac.ts                    # verifyMetaSignature
│   │   └── errors.ts                  # MetaError class hierarchy
│   ├── meta/
│   │   ├── whatsapp/
│   │   │   ├── adapter.ts             # MetaWhatsAppAdapter implements IChannelAdapter
│   │   │   ├── webhook.parser.ts
│   │   │   ├── serializer.ts
│   │   │   └── errors.ts              # códigos específicos WA (130472, 131026, ...)
│   │   └── instagram/
│   │       ├── adapter.ts             # MetaInstagramAdapter implements IChannelAdapter
│   │       ├── webhook.parser.ts      # parse entry[].messaging[] + entry[].changes[].value (comments)
│   │       ├── serializer.ts          # text, generic_template, quick_replies, message_tag
│   │       ├── stories.ts             # download story media (URL expirável)
│   │       ├── comments.ts            # list, hide, delete, private_reply
│   │       └── errors.ts
│   └── waha/
│       ├── adapter.ts
│       └── ...
```

### 5.2 `MetaInstagramAdapter` resumido

```ts
// packages/channels/src/meta/instagram/adapter.ts
import { IChannelAdapter, InboundEvent, SendResult } from '../../types.js';

export class MetaInstagramAdapter implements IChannelAdapter {
  readonly provider = 'meta_instagram' as const;

  constructor(private graph: GraphClient) {}

  async parseInbound(payload: MetaInstagramWebhook, channel: Channel): Promise<InboundEvent[]> {
    const events: InboundEvent[] = [];
    for (const entry of payload.entry) {
      // 1. messaging[] = DMs, postbacks, reactions, seen, referrals, story mentions/replies
      for (const m of entry.messaging ?? []) {
        if (m.message?.is_echo) continue;                              // skip self-sent echoes
        if (m.message?.is_deleted) continue;                            // tratado em messages.deleted_at
        if (m.message?.attachments?.some(a => a.type === 'story_mention')) {
          events.push(this.parseStoryMention(m, channel));
        } else if (m.message?.reply_to?.story) {
          events.push(this.parseStoryReply(m, channel));
        } else if (m.message?.attachments?.some(a => a.type === 'share')) {
          events.push(this.parseShare(m, channel));
        } else if (m.message?.text || m.message?.attachments) {
          events.push(this.parseDirectMessage(m, channel));
        } else if (m.postback) {
          events.push(this.parsePostback(m, channel));
        } else if (m.reaction) {
          events.push(this.parseReaction(m, channel));
        } else if (m.read) {
          events.push(this.parseSeen(m, channel));
        } else if (m.referral) {
          events.push(this.parseReferral(m, channel));
        }
      }
      // 2. changes[] = comments, mentions in feed
      for (const c of entry.changes ?? []) {
        if (c.field === 'comments') events.push(this.parseComment(c.value, channel));
        if (c.field === 'mentions') events.push(this.parseMention(c.value, channel));
      }
    }
    return events;
  }

  async sendText(input: SendTextInput, channel: Channel): Promise<SendResult> {
    const body = {
      recipient: { id: input.contactRemoteId },          // IGSID
      message: { text: input.text },
      messaging_type: input.messageTag ? 'MESSAGE_TAG' : 'RESPONSE',
      ...(input.messageTag && { tag: input.messageTag }),
    };
    return this.graph.post(`/${channel.igUserId}/messages`, body, channel.accessToken);
  }

  async sendMedia(input: SendMediaInput, channel: Channel): Promise<SendResult> {
    const attachmentType = mapMediaKindToIg(input.mediaKind);          // image | video | audio | file
    const body = {
      recipient: { id: input.contactRemoteId },
      message: {
        attachment: {
          type: attachmentType,
          payload: { url: input.publicMediaUrl, is_reusable: false },
        },
      },
    };
    return this.graph.post(`/${channel.igUserId}/messages`, body, channel.accessToken);
  }

  // Instagram NÃO tem templates HSM. Mantém método na interface mas devolve erro tipado.
  async sendTemplate(): Promise<SendResult> {
    return { ok: false, errorCode: 'IG_NO_HSM', errorMessage: 'Instagram does not support HSM templates. Use generic_template/quick_replies inside 24h window or HUMAN_AGENT tag.' };
  }

  async sendInteractive(input: SendInteractiveInput, channel: Channel): Promise<SendResult> {
    // serializa Highermind InteractivePayload (buttons | list | quick_replies | generic_template) para shape IG
    const body = serializeIgInteractive(input.payload, input.contactRemoteId);
    return this.graph.post(`/${channel.igUserId}/messages`, body, channel.accessToken);
  }

  async sendPrivateReplyToComment(input: { commentId: string; text: string }, channel: Channel): Promise<SendResult> {
    return this.graph.post(`/${channel.igUserId}/messages`, {
      recipient: { comment_id: input.commentId },
      message: { text: input.text },
    }, channel.accessToken);
  }

  async replyPublicToComment(input: { commentId: string; text: string }, channel: Channel): Promise<SendResult> {
    return this.graph.post(`/${input.commentId}/replies`, { message: input.text }, channel.accessToken);
  }

  async hideComment(commentId: string, channel: Channel): Promise<void> {
    await this.graph.post(`/${commentId}`, { hide: true }, channel.accessToken);
  }

  async deleteComment(commentId: string, channel: Channel): Promise<void> {
    await this.graph.delete(`/${commentId}`, channel.accessToken);
  }

  async downloadMedia(attachmentUrl: string): Promise<Buffer> {
    // attachments do IG vêm com URL temporária (≈ 5 min) que serve direto o binário
    return this.graph.downloadBinary(attachmentUrl);
  }

  async markAsRead(threadId: string, channel: Channel): Promise<void> {
    await this.graph.post(`/${channel.igUserId}/messages`, {
      recipient: { id: threadId },
      sender_action: 'mark_seen',
    }, channel.accessToken);
  }

  async sendTypingIndicator(threadId: string, kind: 'typing' | 'recording', channel: Channel): Promise<void> {
    // IG só suporta 'typing_on'/'typing_off'; 'recording' degrada para 'typing'
    await this.graph.post(`/${channel.igUserId}/messages`, {
      recipient: { id: threadId },
      sender_action: 'typing_on',
    }, channel.accessToken);
  }
}
```

### 5.3 Discriminated union de Outbound (extensão de LIVECHAT §3.2)

```ts
type OutboundJob =
  | { kind: 'text'; chatId: string; channelId: string; text: string; messageTag?: IgMessageTag }
  | { kind: 'media'; chatId: string; channelId: string; mediaKind: 'image'|'video'|'audio'|'voice'|'document'|'sticker'; storageKey: string; caption?: string; mime: string; messageTag?: IgMessageTag }
  | { kind: 'template'; chatId: string; channelId: string; templateName: string; languageCode: string; components: TemplateComponent[] }   // só WA
  | { kind: 'interactive'; chatId: string; channelId: string; payload: InteractivePayload }
  | { kind: 'ig_private_reply'; channelId: string; commentId: string; text: string }
  | { kind: 'ig_public_reply'; channelId: string; commentId: string; text: string }
  | { kind: 'ig_hide_comment'; channelId: string; commentId: string }
  | { kind: 'typing_indicator'; chatId: string; channelId: string; presence: 'typing'|'recording' };

type IgMessageTag = 'HUMAN_AGENT' | 'CONFIRMED_EVENT_UPDATE' | 'POST_PURCHASE_UPDATE' | 'ACCOUNT_UPDATE';
```

Worker outbound (`dispatchOutbound`) seleciona adapter pela `channel.provider`. Outbound jobs com `kind` incompatível para o provider falham com erro tipado em `dispatch.ts`.

---

## 6. Janela 24h e MESSAGE_TAG

### 6.1 Comparação

| Cenário | WhatsApp | Instagram |
|---|---|---|
| Última mensagem do contato < 24h | OK enviar qualquer tipo | OK enviar qualquer tipo |
| Última mensagem do contato 24h–7d | Só HSM template (MARKETING/UTILITY/AUTH) | `MESSAGE_TAG: HUMAN_AGENT` permitido até 7d; outros tags restritos a contexto |
| > 7d sem interação | Só HSM | **Impossível** enviar (regra Meta IG). Requer re-engagement orgânico (story / ad) |

### 6.2 Composer lock no frontend

```tsx
// apps/web/src/features/conversations/components/Composer.tsx
function getComposerState(conversation: Conversation, channel: Channel): ComposerState {
  const hoursSinceLastInbound = (Date.now() - conversation.lastInboundFromContactAt) / 36e5;

  if (channel.provider === 'meta_whatsapp') {
    if (hoursSinceLastInbound < 24) return { mode: 'open' };
    return { mode: 'template_only', reason: '24h_window_expired_wa' };
  }
  if (channel.provider === 'meta_instagram') {
    if (hoursSinceLastInbound < 24) return { mode: 'open' };
    if (hoursSinceLastInbound < 24 * 7) return { mode: 'human_agent_tag', reason: '24h_window_expired_ig' };
    return { mode: 'blocked', reason: 'ig_messaging_window_closed' };
  }
  return { mode: 'open' }; // waha
}
```

`mode: 'human_agent_tag'` mostra banner: *"Janela 24h fechada. Envie apenas se atendimento humano em andamento (Meta Human Agent Tag) — abuso = perda do permission."* Composer permite texto livre, mas marca outbound com `messageTag: 'HUMAN_AGENT'`.

### 6.3 Audit

Todo outbound com `messageTag` registra em `audit_logs` com `action='outbound.message_tag_used'` e `metadata.tag`, para defesa em revisão Meta.

---

## 7. Comments (post/reel)

### 7.1 Fluxo inbound

```
Usuário comenta em /post/123
        ↓
Webhook entry.changes[ { field: 'comments', value: {...} } ]
        ↓
worker-inbound:
  1. dedup via webhook_events (event_uid = value.id)
  2. ensure ig_comments row
  3. ensure conversation kind='comment_thread' (uma por media_id × contact_igsid)
  4. persist messages row type='comment' linkando ig_comments.id em metadata
  5. emit socket conversation:updated + message:new
        ↓
Frontend: comment_thread aparece na ChatList com badge "💬 Post" (ícone diferente de DM)
```

### 7.2 Ações disponíveis

| Ação | Endpoint Graph | UI |
|---|---|---|
| Responder publicamente | `POST /<comment_id>/replies` | Botão "Responder" → mensagem outbound type=`comment_reply` |
| Responder privadamente (comment-to-DM) | `POST /<ig_user_id>/messages` com `recipient.comment_id` | Botão "Responder por DM" → cria conversation kind=`direct` se não existe e envia |
| Ocultar | `POST /<comment_id>?hide=true` | Toggle "Ocultar" — só dono do post vê |
| Deletar | `DELETE /<comment_id>` | Ação destrutiva, confirmação |
| Curtir | n/a Graph | Não suportado oficialmente |

### 7.3 Auto-moderação (opt-in, fase 2)

Tool `moderate_comment` para agente IA: dado um comment, classifica em `spam | offensive | question | praise | neutral` e age (hide / private_reply / public_reply). Fora do escopo de fundamentos schema-ready do MVP.

---

## 8. Stories (mentions + replies)

### 8.1 Story mention

Usuário marca @workspace em story dele. Webhook:

```json
{
  "messaging": [{
    "sender": { "id": "<igsid>" },
    "recipient": { "id": "<ig_user_id>" },
    "timestamp": 1718000000000,
    "message": {
      "mid": "...",
      "attachments": [{
        "type": "story_mention",
        "payload": { "url": "https://lookaside.fbsbx.com/.../story.jpg?... (expira ~5min)" }
      }]
    }
  }]
}
```

Worker inbound:
1. Cria/encontra `conversation` com `kind='story_thread'`, `metadata.story_id`.
2. Persiste `messages` com `type='story_mention'`, `media_url` aponta para a URL temporária inicialmente.
3. Enfileira em `hm.q.inbound.media` para download imediato (a URL expira); worker media salva no R2 e atualiza `messages.media_url`.

### 8.2 Story reply

Usuário responde com texto a um story do workspace:

```json
{
  "messaging": [{
    "sender": { "id": "<igsid>" },
    "recipient": { "id": "<ig_user_id>" },
    "message": {
      "mid": "...",
      "text": "Lindo!",
      "reply_to": { "story": { "url": "...", "id": "<story_media_id>" } }
    }
  }]
}
```

Persistido como `type='story_reply'` com `metadata.story_id` e `metadata.story_url`. Conversation pode ser `direct` (default; Meta trata replies como DM) ou agrupada em `story_thread` por `story_id` — **decisão v2:** mantém em `kind='direct'` para não fragmentar o histórico do contato. `metadata.story_id` permite filtro futuro.

---

## 9. Interactive payloads — extensão IG

`packages/shared/src/types/interactive.ts` ganha novas variantes na discriminated union:

```ts
export const IgQuickRepliesSchema = z.object({
  type: z.literal('ig_quick_replies'),
  text: z.string().min(1),
  options: z.array(z.object({
    title: z.string().max(20),
    payload: z.string().max(1000),         // postback payload
    image_url: z.string().url().optional(),
  })).min(1).max(13),
});

export const IgGenericTemplateSchema = z.object({
  type: z.literal('ig_generic_template'),
  elements: z.array(z.object({
    title: z.string().max(80),
    subtitle: z.string().max(80).optional(),
    image_url: z.string().url().optional(),
    default_action: z.object({ type: z.literal('web_url'), url: z.string().url() }).optional(),
    buttons: z.array(z.object({
      type: z.enum(['web_url','postback']),
      title: z.string().max(20),
      url: z.string().url().optional(),
      payload: z.string().max(1000).optional(),
    })).max(3).optional(),
  })).min(1).max(10),
});

export const IgButtonTemplateSchema = z.object({
  type: z.literal('ig_button_template'),
  text: z.string().max(640),
  buttons: z.array(z.object({
    type: z.enum(['web_url','postback']),
    title: z.string().max(20),
    url: z.string().url().optional(),
    payload: z.string().max(1000).optional(),
  })).min(1).max(3),
});

export const InteractivePayloadSchema = z.discriminatedUnion('type', [
  InteractiveButtonsSchema,
  InteractiveListSchema,
  InteractiveTemplateSchema,            // WA HSM
  IgQuickRepliesSchema,                  // IG
  IgGenericTemplateSchema,               // IG
  IgButtonTemplateSchema,                // IG
]);
```

Frontend `<MessageBubble>` despacha por `type`. Composer só oferece tipos compatíveis com `channel.provider`.

---

## 10. Agentes IA — tools sensíveis a IG

Tools que mudam de comportamento conforme o canal:

| Tool | Comportamento por canal |
|---|---|
| `send_interactive` | WA: buttons/list/template. IG: quick_replies/generic_template/button_template. Tool resolve em runtime baseado em `conversation.channel.provider`. |
| `transfer_to_human` | Igual em todos os canais. |
| `schedule_event` | Igual. |
| `search_knowledge_base` | Igual. |

Novas tools específicas (implementação F1.5+):

| Tool | Categoria | Descrição |
|---|---|---|
| `reply_to_comment` | `workflow` | Responde a um comment público (precisa `conversation.kind='comment_thread'`) |
| `private_reply_to_comment` | `workflow` | Comment-to-DM; cria conversation direct se ainda não existe |
| `hide_comment` | `workflow` (requires_human_approval=true por default) | Esconde comment |
| `delete_comment` | `workflow` (requires_human_approval=true sempre) | Deleta comment |

System prompt dos templates `support` e `reception` ganha trecho condicional quando `channel.provider='meta_instagram'`:

> *"Você está atendendo via Instagram. Janela de mensagens proativas é mais curta que WhatsApp. Para comentários em posts, escolha conscientemente entre responder publicamente (visível a todos) ou privadamente (DM). Não esconda comentários a menos que sejam claramente spam ou ofensivos."*

---

## 11. Campaigns

### 11.1 Tipos suportados em IG

| Tipo | WhatsApp | Instagram |
|---|---|---|
| `broadcast` | ✅ HSM aprovado | ⚠ Só com `MESSAGE_TAG` válido + dentro de 7d da última interação |
| `drip` | ✅ | ⚠ Cada step precisa estar dentro da janela válida do recipient |
| `triggered` | ✅ | ✅ Dispara em response a evento dentro de 24h |

### 11.2 Validação pré-ativação (extensão de CAMPAIGNS §5)

Se `channel.provider='meta_instagram'`:
- **Sem `template_name`** — IG não tem HSM. Step usa `text` ou `interactive` payload.
- **`message_tag` é obrigatório** se step pode ser enviado fora da janela 24h.
- **Recipients sem interação prévia** — IG **proíbe** outbound proativo a usuários que nunca DM'aram o workspace. Validation bloqueia.

### 11.3 Não-objetivo

Campanhas de IG via comments (responder em massa) **não** são objetivo. Pode parecer útil mas viola TOS Meta.

---

## 12. UI

### 12.1 Channel connection wizard

`features/settings/channels/ConnectChannelWizard.tsx`:

```
Step 1: Escolha do canal
        [WhatsApp Business] [Instagram] [WAHA (não-oficial)]
        
Step 2: Facebook Login (Embedded Signup)
        Solicita scopes combinados (WA + IG)
        
Step 3: Seleção de conta
        - Para WA: WABA + número
        - Para IG: Página FB + IG Business Account vinculada
        
Step 4: Webhook subscription
        Highermind chama Graph para inscrever Page + IGBA
        no app webhook
        
Step 5: Test message
        Envia "Olá do Highermind" pro IG do próprio workspace owner
        Confirma channel.is_active = true
```

### 12.2 ChatList — distinção visual de canal

Cada conversa exibe ícone do provider (logo WA verde / IG gradient). Filtro de canal no topbar permite isolar IG-only.

### 12.3 Comment thread UI

Diferente do chat 1:1:
- Header mostra preview do post/reel (thumbnail + caption truncada).
- Mensagens ficam visualmente como cards aninhados (parent comment + replies).
- Composer tem toggle "Responder publicamente / por DM".
- Botões `Ocultar`, `Excluir` em hover de cada comment.

### 12.4 Story mention card

`MessageBubble.StoryMention`:
- Renderiza preview da imagem/vídeo do story (após media worker salvar em R2).
- Badge "@menção em story" + timestamp.
- CTA "Ver story original" abre URL Instagram (se ainda válida).

---

## 13. Sockets

Mesmos eventos do LiveChat (vide LIVECHAT §6). Sem eventos novos — `kind='comment_thread'` e `type='story_mention'` etc. são entregues nos mesmos `message:new` / `conversation:updated`.

---

## 14. Observability

Métricas dedicadas (OTel):

- `hm.ig.messages.received{type}` — counter por subtipo (dm, story_mention, story_reply, share, comment).
- `hm.ig.comments.actions{action}` — counter (reply_public, reply_private, hide, delete).
- `hm.ig.outbound.message_tag_used{tag}` — counter por tag.
- `hm.ig.window.outbound_blocked` — counter de tentativas bloqueadas (janela fechada).

Logs com prefix `ig.*` separados de `wa.*` para filtro fácil.

---

## 15. Segurança e compliance

- **Token storage:** cifrado AES-256-GCM em `channel_secrets` (mesmo padrão WA). System User token é long-lived, mas tem rotação anual recomendada.
- **Webhook signature:** sempre verificada antes de qualquer parse (mesma função compartilhada WA+IG).
- **LGPD:** opt-in implícito ao DM iniciado pelo usuário; opt-out por keyword segue mesma lógica de WA (STOP/PARAR/SAIR/CANCELAR). Para outbound proativo via `MESSAGE_TAG`, log de justificativa em `audit_logs`.
- **PII em logs:** `igsid` e `username` mascarados em logs estruturados (regra Pino redact estendida).
- **App Review:** documentação de uso de cada permission (especialmente `instagram_manage_comments`) preparada em `docs/runbooks/meta-app-review-instagram.md`.

---

## 16. Não-objetivos do MVP (schema-ready) e da fase F1.5

### 16.1 Fora do schema-ready (MVP)

Nada além de schema/naming/adapter interface no MVP. Implementação real fica para F1.5.

### 16.2 Fora da F1.5 (primeira implementação completa)

- ❌ **Anúncios Click-to-Instagram-DM nativo** — `referral` é parseado e persistido, mas atribuição de campanha avançada vai para fase F1.6+.
- ❌ **IG Shopping / product tags / cart** — sem suporte; produto é fora do MVP.
- ❌ **Análise automatizada de sentimento em comments** — fase 2 (cobertura tool `moderate_comment`).
- ❌ **Resposta a Reels remixed / collabs** — eventos suportados mas UX dedicada fica para depois.
- ❌ **Multi-account Instagram para um único workspace** — schema suporta (vários `channels` rows), UI assume default; UI para múltiplos canais IG no mesmo workspace = F2.
- ❌ **Instagram Threads (app)** — Meta lançou API separada; fora deste documento.

---

## 17. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Token Page Access expirar após 60d (versão short-lived) | Workspace setup força System User token long-lived; cron `monthly` testa validade de cada token |
| URL temporária de story expira antes do worker baixar | `hm.q.inbound.media` é alta-prioridade para IG attachments; worker media com retry 3× em < 4min |
| Comment com volume alto (post viral) sobrecarrega worker-inbound | `channel.prefetch` ajustado; alerta em queue lag > 1000 |
| Meta tirar `instagram_manage_comments` em App Review | Comment thread como módulo isolado (feature flag `IG_COMMENTS_ENABLED`); core DM funciona sem |
| Diferenças sutis entre IG `Personal Account` vs `Business` vs `Creator` | Validation no signup força Business/Creator; rejeita Personal |
| Mudanças de payload por Meta (sem notice) | Logger gravita `webhook_events.raw_payload` por 30d; quebra detectável; runbook de hotfix |

---

## 18. Próximos passos (post-MVP, F1.5)

1. Implementar `MetaInstagramAdapter` parsing + send.
2. Estender `MetaGraphClient` (compartilhado) para suportar endpoints v23.0 IG.
3. Webhook unificado `/webhooks/meta` ganha branch `instagram`.
4. Worker inbound trata `story_mention`, `story_reply`, `share`, `comment`, `postback`, `referral`.
5. UI: ConnectChannelWizard step Instagram + comment thread layout + story mention bubble.
6. App Review Meta (runbook).
7. Test fixture com mock webhook IG (msw em `apps/api/tests/fixtures/ig-webhooks/`).
8. Tools IA específicas (`reply_to_comment`, `private_reply_to_comment`, `hide_comment`).

---

> Domínio gêmeo do LiveChat WhatsApp. O design objetiva máxima reutilização (cliente Graph, HMAC, retry, dedup, sockets) e isolamento estrito do que diverge (parsers, serializers, restrição de janelas).
