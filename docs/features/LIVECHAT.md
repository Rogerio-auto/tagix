# Feature — LIVECHAT (núcleo)

> **Domínio:** Inbox unificada, conversas em tempo real, canais Meta (WhatsApp + Instagram) e WAHA
> **Pacotes:** `apps/api`, `apps/workers/{inbound,outbound,media}`, `packages/channels`, `packages/shared`, `apps/web/src/features/conversations`
> **Instagram:** schema/adapter interface/webhook unificado prontos no MVP; implementação completa em F1.5. Especificidades em [`INSTAGRAM.md`](./INSTAGRAM.md).

---

## 1. Fluxo de mensagem inbound

```
WhatsApp / Instagram → Meta webhook (mesmo Meta App, Tech Provider único)
                       OU WAHA → POST direto
              ↓
        POST /webhooks/meta           [verify signature HMAC sha256 com app_secret]
        POST /webhooks/waha           [verify api key WAHA]
              ↓
        despacho por body.object (whatsapp_business_account | instagram)
              ↓
        publish hm.channels → "inbound.message" com payload.provider preenchido
              ↓
        hm.q.inbound.message  ◄─────  worker-inbound (parser por provider)
              ↓
   ┌──────────────────────────────┐
   │  1. parse + Zod validate     │
   │  2. dedup via webhook_events │
   │  3. ensure contact           │
   │  4. ensure conversation      │
   │  5. persist messages         │
   │  6. update conversation.last │
   │  7. if media → enqueue media │
   │  8. bump cache version       │
   │  9. publish socket relay     │
   │ 10. if ai_mode='on'          │
   │     → enqueue flow or agent  │
   └──────────────────────────────┘
              ↓
        hm.q.socket.relay
              ↓
        api server consumes  ──────►  Socket.io emit
              ↓                       to conversation:{id}
                                      to workspace:{wsId}
              ↓
        Frontend updates ChatList + Conversation
```

---

## 2. Provider adapters

### 2.1 IChannelAdapter interface

```ts
// packages/channels/src/types.ts
export type ChannelProvider = 'meta_whatsapp' | 'meta_instagram' | 'waha';

export interface IChannelAdapter {
  readonly provider: ChannelProvider;

  parseInbound(payload: unknown, channel: Channel): Promise<InboundEvent[]>;

  sendText(input: SendTextInput, channel: Channel): Promise<SendResult>;
  sendMedia(input: SendMediaInput, channel: Channel): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput, channel: Channel): Promise<SendResult>;    // WA only; IG retorna IG_NO_HSM
  sendInteractive(input: SendInteractiveInput, channel: Channel): Promise<SendResult>;

  downloadMedia(refOrUrl: string, channel: Channel): Promise<Buffer>;
  markAsRead(externalId: string, channel: Channel): Promise<void>;
  sendTypingIndicator(externalId: string, kind: 'typing' | 'recording', channel: Channel): Promise<void>;

  // Capabilities advertise (UI usa para esconder/mostrar ações)
  readonly capabilities: {
    templatesHSM: boolean;          // só meta_whatsapp
    storyMentions: boolean;         // só meta_instagram
    storyReplies: boolean;          // só meta_instagram
    publicComments: boolean;        // só meta_instagram
    messageTags: boolean;           // só meta_instagram (HUMAN_AGENT, etc.)
    voicePtt: boolean;              // só meta_whatsapp + waha
    sticker: boolean;               // meta_whatsapp + waha
    location: boolean;              // meta_whatsapp + waha
  };
}

// HMAC verify e webhook receive são SHARED, não por adapter (mesmo Meta App = mesmo app_secret).
// packages/channels/src/shared/hmac.ts exporta verifyMetaSignature(req, appSecret).

type InboundEvent =
  | { type: 'message'; provider: ChannelProvider; contactRemoteId: string; externalId: string; messageType: MessageType; content?: string; mediaRef?: MediaRef; rawTimestamp: string; metadata?: Record<string, unknown> }
  | { type: 'status'; provider: ChannelProvider; externalId: string; status: 'sent'|'delivered'|'read'|'failed'; rawTimestamp: string }
  | { type: 'flow_submission'; provider: 'meta_whatsapp'; metaFlowId: string; response: unknown; externalId: string }
  | { type: 'story_mention'; provider: 'meta_instagram'; contactRemoteId: string; externalId: string; mediaRef: MediaRef; storyId: string }
  | { type: 'story_reply'; provider: 'meta_instagram'; contactRemoteId: string; externalId: string; storyId: string; content: string }
  | { type: 'share'; provider: 'meta_instagram'; contactRemoteId: string; externalId: string; mediaRef: MediaRef }
  | { type: 'comment'; provider: 'meta_instagram'; mediaId: string; mediaKind?: 'post'|'reel'|'story'; commentId: string; parentCommentId?: string; fromIgsId: string; fromUsername?: string; text?: string }
  | { type: 'postback'; provider: 'meta_instagram'; contactRemoteId: string; externalId: string; payload: string; title?: string }
  | { type: 'reaction'; provider: ChannelProvider; contactRemoteId: string; targetExternalId: string; emoji: string }
  | { type: 'referral'; provider: 'meta_instagram'; contactRemoteId: string; source: string; referralData: Record<string, unknown> };

type SendResult =
  | { ok: true; externalId: string; raw?: unknown }
  | { ok: false; errorCode: string; errorMessage: string; raw?: unknown };
```

### 2.2 Adapters Meta (WhatsApp + Instagram)

Pasta `packages/channels/src/meta/` contém código compartilhado e dois adapters distintos:

```
packages/channels/src/
├── shared/
│   ├── graphClient.ts      # cliente HTTP comum (graph.facebook.com/v23.0) + retry + token refresh
│   ├── hmac.ts             # verifyMetaSignature (app_secret único)
│   └── errors.ts           # MetaError class + códigos compartilhados
├── meta/
│   ├── whatsapp/
│   │   ├── adapter.ts      # MetaWhatsAppAdapter implements IChannelAdapter
│   │   ├── webhook.parser.ts
│   │   ├── serializer.ts
│   │   └── errors.ts       # códigos WA-específicos (130472, 131026, 131047, 131051, 132001, ...)
│   └── instagram/
│       ├── adapter.ts      # MetaInstagramAdapter implements IChannelAdapter
│       ├── webhook.parser.ts
│       ├── serializer.ts   # quick_replies, generic_template, button_template, message_tag
│       ├── stories.ts      # parse + download de story_mention/reply
│       ├── comments.ts     # parse + actions (hide, delete, private_reply, public_reply)
│       └── errors.ts
└── waha/
    ├── adapter.ts
    ├── webhook.parser.ts
    ├── client.ts
    └── session.ts
```

Detalhe do `MetaInstagramAdapter`, parsing de webhook IG, comment thread e story handling: [`INSTAGRAM.md`](./INSTAGRAM.md).

### 2.3 WAHAAdapter

`packages/channels/src/waha/`:
- `webhook.parser.ts` — recebe POST, valida API key
- `client.ts` — WAHA HTTP API
- `session.ts` — ensure session ativa, retry com 409/422 handling

### 2.4 Webhook Meta unificado

Um único endpoint para os dois produtos Meta (WhatsApp Cloud + Instagram), porque ambos vivem no **mesmo Meta App** (Highermind como Tech Provider único):

```ts
// apps/api/src/routes/webhooks/meta.ts
const META_APP_SECRET = platformSecrets.get('meta_app_secret');
const META_VERIFY_TOKEN = platformSecrets.get('meta_webhook_verify_token');

router.get('/webhooks/meta', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === META_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

router.post('/webhooks/meta', verifyMetaSignature(META_APP_SECRET), async (req, res) => {
  const body = req.body as MetaWebhookEnvelope;
  switch (body.object) {
    case 'whatsapp_business_account':
      await publishChannels({ type: 'inbound.message', provider: 'meta_whatsapp', payload: body });
      break;
    case 'instagram':
      await publishChannels({ type: 'inbound.message', provider: 'meta_instagram', payload: body });
      break;
    default:
      logger.warn({ object: body.object }, 'webhook.meta.unknown_object');
  }
  res.sendStatus(200);   // Meta exige < 5s
});
```

WAHA continua com endpoint próprio `/webhooks/waha` (provider não-Meta).

---

## 3. Outbound flow

### 3.1 Composition (mantém v1)

```
worker-outbound consume hm.q.outbound.request
     ↓
parseOutboundEnvelope (Zod)
     ↓
acquire per-chat lock (Redis, TTL 90s)
     ↓
dispatchOutbound (decide provider + type)
     ↓
processOutbound (chama adapter respectivo)
     ↓
finalizeOutbound (update messages.view_status, socket emit)
     ↓
ack/nack
```

### 3.2 Discriminated union de outbound

```ts
type IgMessageTag = 'HUMAN_AGENT' | 'CONFIRMED_EVENT_UPDATE' | 'POST_PURCHASE_UPDATE' | 'ACCOUNT_UPDATE';

type OutboundJob =
  | { kind: 'text'; chatId: string; channelId: string; text: string; replyToExternalId?: string; messageTag?: IgMessageTag }
  | { kind: 'media'; chatId: string; channelId: string; mediaKind: 'image'|'video'|'audio'|'voice'|'document'|'sticker'; storageKey: string; caption?: string; mime: string; replyToExternalId?: string; messageTag?: IgMessageTag }
  | { kind: 'template'; chatId: string; channelId: string; templateName: string; languageCode: string; components: TemplateComponent[] }    // só meta_whatsapp
  | { kind: 'interactive'; chatId: string; channelId: string; payload: InteractivePayload }
  // Instagram-specific
  | { kind: 'ig_private_reply'; channelId: string; commentId: string; text: string }
  | { kind: 'ig_public_reply'; channelId: string; commentId: string; text: string }
  | { kind: 'ig_hide_comment'; channelId: string; commentId: string }
  | { kind: 'ig_delete_comment'; channelId: string; commentId: string }
  // presence
  | { kind: 'typing_indicator'; chatId: string; channelId: string; presence: 'typing'|'recording' };
```

`dispatch.ts` valida coerência `kind ↔ channel.provider` (ex: `template` só em `meta_whatsapp`; `ig_*` só em `meta_instagram`) e retorna erro tipado em caso de mismatch — falha rápida no worker, não na borda Meta.

### 3.3 Janela de envio por provider (FX-011 generalizado)

A regra depende do `channel.provider`:

| Provider | < 24h da última inbound | 24h–7d | > 7d |
|---|---|---|---|
| `meta_whatsapp` | Composer livre | Bloqueado, CTA "Reabrir com template Meta" | Idem |
| `meta_instagram` | Composer livre | Composer livre + banner "Janela 24h fechada — Human Agent Tag será aplicado (uso responsável; Meta audita)" + outbound recebe `messageTag: 'HUMAN_AGENT'` | Bloqueado, CTA "Aguardar reengajamento (story, ad)"  |
| `waha` | Composer livre | Composer livre | Composer livre |

Implementação em `getComposerState(conversation, channel)` (mostrada em [INSTAGRAM.md §6](./INSTAGRAM.md#6-janela-24h-e-message_tag)). Audit log obrigatório em todo outbound com `messageTag != null`.

### 3.4 Per-chat FIFO lock

```ts
await runWithDistributedLock(
  `hm:lock:outbound:${conversationId}`,
  90_000,
  async () => {
    // 1. validate
    // 2. send via adapter
    // 3. persist message
    // 4. update conversation.last_*
    // 5. emit socket
  },
);
```

Garante ordem entre mensagens enviadas em sequência rápida (FX-007).

### 3.5 Typing/recording (FX-008)

Antes de enviar mensagem com `pre_action` configurado:

```ts
await adapter.sendTypingIndicator(lastInboundExternalId, preAction === 'recording' ? 'recording' : 'typing', channel);
await sleep(preActionDurationMs);
await adapter.sendText(...);
```

---

## 4. Tipos de mensagem

| Tipo | DB `type` | Providers | Adapter Method | Frontend rendering |
|---|---|---|---|---|
| Texto puro | `text` | WA + IG + WAHA | sendText | `<MessageBubble.Text>` |
| Imagem | `image` | WA + IG + WAHA | sendMedia | `<MessageBubble.Image>` (lightbox on click) |
| Vídeo | `video` | WA + IG + WAHA | sendMedia | `<MessageBubble.Video>` |
| Áudio (audio file) | `audio` | WA + IG + WAHA | sendMedia | `<MessageBubble.Audio>` (controls) |
| Áudio voz (PTT) | `voice` | WA + WAHA | sendMedia | `<MessageBubble.Voice>` (waveform) |
| Documento | `document` | WA + WAHA + IG (`file`) | sendMedia | `<MessageBubble.Document>` (filename + download) |
| Sticker | `sticker` | WA + WAHA | sendMedia | `<MessageBubble.Sticker>` |
| Localização | `location` | WA + WAHA | sendInteractive | `<MessageBubble.Location>` (mini-map) |
| Contato | `contact` | WA + WAHA | sendInteractive | `<MessageBubble.Contact>` (vCard summary) |
| Interativo buttons | `interactive` (buttons / button_template) | WA + IG | sendInteractive | `<MessageBubble.InteractiveButtons>` |
| Interativo list | `interactive` (list) | WA | sendInteractive | `<MessageBubble.InteractiveList>` |
| Quick replies | `interactive` (ig_quick_replies) | IG | sendInteractive | `<MessageBubble.QuickReplies>` |
| Generic template | `interactive` (ig_generic_template) | IG | sendInteractive | `<MessageBubble.GenericTemplate>` (carousel) |
| Template Meta HSM | `template` | **WA only** | sendTemplate | `<MessageBubble.Template>` |
| Reação emoji | `reaction` | WA + IG | sendText (workaround WA) / adapter dedicado IG | `<MessageBubble.Reaction>` |
| Sistema (system note) | `system` | n/a | (não enviado externo) | `<MessageBubble.System>` (centered) |
| Story mention (recebida) | `story_mention` | **IG only** | n/a (inbound) | `<MessageBubble.StoryMention>` (thumbnail + badge) |
| Story reply (recebida) | `story_reply` | **IG only** | n/a (inbound) | `<MessageBubble.StoryReply>` (texto com snippet do story) |
| Share (recebido) | `share` | **IG only** | n/a (inbound) | `<MessageBubble.Share>` (preview do post/reel) |
| Comment | `comment` | **IG only** | n/a (inbound) | `<MessageBubble.Comment>` (em `comment_thread`) |
| Comment reply | `comment_reply` | **IG only** | replyPublicToComment | `<MessageBubble.Comment>` outbound |
| Postback | `ig_postback` | **IG only** | n/a (inbound) | `<MessageBubble.Text>` (com badge "Botão clicado: …") |
| Referral | `referral` | **IG only** | n/a (inbound) | `<MessageBubble.Referral>` (origem: ad/m.me) |

### 4.1 `interactive_payload` discriminated union

Resolve TODO FX-023d do v1.

```ts
// packages/shared/src/types/interactive.ts
import { z } from 'zod';

export const InteractiveButtonsSchema = z.object({
  type: z.literal('buttons'),
  header: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  buttons: z.array(z.object({ id: z.string(), text: z.string() })).min(1).max(3),
});

export const InteractiveListSchema = z.object({
  type: z.literal('list'),
  header: z.string().optional(),
  body: z.string(),
  footer: z.string().optional(),
  button: z.string(),
  sections: z.array(z.object({
    title: z.string(),
    rows: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().optional() })),
  })).min(1),
});

export const InteractiveTemplateSchema = z.object({
  type: z.literal('template'),
  name: z.string(),
  languageCode: z.string(),
  components: z.array(z.any()), // shape Meta-specific
});

export const InteractivePayloadSchema = z.discriminatedUnion('type', [
  InteractiveButtonsSchema,
  InteractiveListSchema,
  InteractiveTemplateSchema,
]);
export type InteractivePayload = z.infer<typeof InteractivePayloadSchema>;
```

Validado no boundary (insert/select) com Zod parse. Frontend renderiza polimorficamente via switch.

---

## 5. Mídia pipeline

### 5.1 Inbound

Worker inbound detecta `mediaRef` no inbound event → publica em `hm.q.inbound.media`:

```ts
{
  workspaceId,
  messageId,
  channelId,
  mediaRef: { provider: 'meta_cloud', externalMediaId: '...', mime: 'image/jpeg' },
}
```

Worker media:
1. Download via `adapter.downloadMedia(externalMediaId, channel)`.
2. Calcula SHA-256.
3. Verifica dedup (se outro `messages.media_sha256` igual existe, reusa `media_url`).
4. Upload em R2 com key `{workspaceId}/{year}/{month}/{day}/{uuid}.{ext}`.
5. Update `messages.media_url`, `media_mime`, `media_size_bytes`, `media_sha256`.
6. Emit socket `message:media_ready`.
7. Frontend troca placeholder por mídia carregada.

### 5.2 Outbound

Frontend faz upload via:
- Endpoint `POST /api/uploads/signed-url` retorna URL pré-assinada R2.
- Browser uploadа direto.
- Backend recebe confirmação + cria mensagem com `storageKey`.

(Alternativa MVP: backend recebe multipart, upload via driver. Mais simples, menos perf.)

### 5.3 Encoding/conversão

Worker media usa:
- **ffmpeg** para conversão video → MP4 H.264 + audio → OGG/M4A.
- **sharp** para compressão imagem → JPEG q=80 ou WebP.
- Slot limit `OUTBOUND_MEDIA_MAX_CONCURRENCY=2` previne pico de memória.

---

## 6. Socket events

```ts
// packages/shared/src/socket-events.ts
type ServerToClient = {
  'message:new': (p: { workspaceId: string; conversationId: string; message: Message }) => void;
  'message:status_changed': (p: { conversationId: string; messageId: string; status: ViewStatus }) => void;
  'message:media_ready': (p: { conversationId: string; messageId: string; mediaUrl: string }) => void;
  'conversation:updated': (p: { workspaceId: string; conversation: Conversation }) => void;
  'conversation:assigned': (p: { conversationId: string; assignedTo: string | null }) => void;
  'conversation:routing_changed': (p: { conversationId: string; routing: RoutingChange }) => void;
  'typing:from_contact': (p: { conversationId: string; presence: 'typing'|'recording' }) => void;
  'agent_execution:started': (p: { conversationId: string; agentId: string; executionId: string }) => void;
  'agent_execution:completed': (p: { conversationId: string; agentId: string; executionId: string }) => void;
  'flow_execution:started': (p: { conversationId: string; flowId: string; executionId: string }) => void;
  'flow_execution:cancelled': (p: { conversationId: string; flowId: string; executionId: string }) => void;
};
```

Rooms:
- `conversation:{id}` — quem está com a conversa aberta no momento
- `workspace:{wsId}` — quem está logado na app (inbox + dashboards)
- `member:{memberId}` — eventos pessoais (notificações)

---

## 7. UI: ConversationsPage

### 7.1 Layout

3 colunas: ChatList | ConversationPanel | ContactInfoPanel (toggle).

### 7.2 ChatList

- Filters: status (open/pending/resolved/snoozed), department, team, assigned (me/others), tag.
- Search: por nome/telefone com debounce 300ms.
- Sort: last_message_at DESC.
- Real-time: ouve `conversation:updated`, `message:new` (se conversation já na lista, bump).
- Lazy: 50 inicial + scroll infinito.

### 7.3 ConversationPanel

- Header: avatar contato + nome + status + dropdown ações (resolver, snooze, transfer, attach to deal).
- Messages list: scroll virtualizado (react-window) — necessário pra históricos longos.
- Composer: textarea + emoji picker + attach button + send button (Cmd+Enter).
- Lock no composer se fora janela 24h Meta.
- Mention `@` → dropdown de members do workspace.
- Quote/reply mode: indicador no composer.

### 7.4 ContactInfoPanel

- Avatar + nome + telefone/email + tags + custom_fields.
- Deals associados (com link).
- Próximos eventos.
- Notas internas (com mentions).
- Histórico de routing.
- Botão "Editar contato".

### 7.5 Manual flows quickbar (FX-029d)

Abaixo do composer: barra horizontal de flows manuais ordenados por `manual_position`. Click dispara modal de confirmação → cria `flow_execution`.

### 7.6 Flow executions badges (FX-031c/d)

- Header da conversa: badge mostra count de flows em execução ativa.
- Item da ChatList: ícone pequeno com tooltip se conversa tem execução ativa.

---

## 8. Cache strategy

| O quê | Key | TTL | Invalidação |
|---|---|---|---|
| Conversation snapshot | `hm:conv:{id}` | 30s | bump `hm:conv:v:{id}` em writes |
| List query | `hm:conv:list:{wsId}:v{wsVersion}:{filterHash}` | 120s | bump `hm:ws:v:{wsId}` em writes globais |
| Messages page | `hm:msg:{convId}:cursor:{cursor}:limit:{limit}` | 60s | delete keys do SET `hm:msg:set:{convId}` em new message |
| Contact lookup | `hm:contact:lookup:{channelId}:{remoteId}` | 120s | bump em writes |
| Auth token | `hm:auth:{sha}` | 300s | implicit (logout/expire) |

---

## 9. Tests

- **Unit:** Zod schemas (interactive_payload, OutboundJob), parsers Meta/WAHA, key builders.
- **Integration:** webhook end-to-end com Postgres real (testcontainers) + RabbitMQ real.
- **e2e:** Playwright simula chat completo (login → enviar mensagem → ver na lista → real-time).

---

## 10. Métricas

- Inbound latency P95 (`message:new` emit) < 1s.
- Outbound P95 from `POST /messages` ao Meta `200 OK` < 500ms.
- Cache hit rate em `hm:conv:list:*` > 80%.
- Erro rate de webhook signature inválida = 0 em prod.

---

## 11. Pontos não cobertos no MVP

- **Adapter Instagram completo:** fundamentos prontos (schema + interface + webhook unificado + UI placeholders). Implementação real do `MetaInstagramAdapter` (parser de DMs, stories, comments, postbacks; sender; comment moderation) na fase **F1.5** logo após o MVP. Vide [`INSTAGRAM.md`](./INSTAGRAM.md).
- Group chats: schema preparado (`kind='group'`), mas UI específica fica fase 2.
- Reaction messages: schema preparado, mas UX limitada (WhatsApp tem 1 reaction por msg; Instagram suporta love).
- Forwarded messages: schema mantém `metadata.forwarded`, mas UX não destaca no MVP.
- Voice transcription automática (Whisper) em msg recebida: fase 2.
- Threads/replies infinitos: MVP só 1 nível de reply.

---

## 12. Riscos & mitigations

| Risco | Mitigação |
|---|---|
| Meta muda webhook payload (WA ou IG) | Adapters isolados; mudança = atualizar `meta/{whatsapp,instagram}/webhook.parser.ts` apenas; `webhook_events.raw_payload` mantido por 30d para hotfix |
| Perda de App Review IG (`instagram_manage_comments` revogado) | Feature flag `IG_COMMENTS_ENABLED`; canal Instagram core continua funcionando sem comments |
| Token Page Access do IG expira após 60d | System User token long-lived; cron `monthly` testa validade; alerta no painel super-admin |
| URL temporária de mídia IG expira antes do worker baixar | `hm.q.inbound.media` com alta prioridade para attachments IG; retry 3× em < 4min |
| WAHA session deauth no meio do dia | Notificação para admin + UI mostra status do channel |
| Burst de mensagens dropa em RabbitMQ | DLX + retry; alerta se queue > 1000 |
| Mídia muito grande estoura memória do worker | Stream + sharp/ffmpeg max-size 25MB |
| Cache miss after invalidate causa thundering herd | Redlock single-flight em `getConversation` |

---

> Domínio mais central do produto. Quality aqui = quality percebida do produto.
