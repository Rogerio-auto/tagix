# DATA_MODEL — Highermind v2

> **Documento:** Modelo de dados (Postgres 16 + pgvector + Drizzle)
> **Versão:** 0.1 — 2026-06-06
> **Convenções:** snake_case em SQL; camelCase em TypeScript; UUID em PKs; timestamps com timezone.

---

## 1. Princípios

1. **Toda tabela com dados de tenant tem `workspace_id`** e RLS habilitada.
2. **Toda tabela tem `id uuid primary key default gen_random_uuid()`**.
3. **Toda tabela tem `created_at timestamptz not null default now()`** e a maioria tem `updated_at timestamptz`.
4. **Soft delete via `deleted_at timestamptz`** somente em entidades com requisito explícito (contacts, messages para LGPD). Demais usam hard delete.
5. **Sem ENUM no Postgres** — usar `text` + `CHECK` constraint. Adicionar valor a ENUM é dor de migration; CHECK é trivial.
6. **JSONB para flexibilidade explícita** (config, metadata, custom_fields). Quando o shape é estável, virar coluna tipada.
7. **Índices planejados desde o schema.** Toda query do código tem que ter índice correspondente. Nunca confiar em sequential scan.
8. **Foreign keys com `ON DELETE` explícito** — CASCADE para filhos, SET NULL para referências opcionais, RESTRICT para impedir.
9. **Naming uniforme:**
   - Tabelas: plural (`workspaces`, `conversations`)
   - Colunas FK: singular + `_id` (`workspace_id`, `contact_id`)
   - Booleans: `is_<adj>` ou `has_<noun>` (`is_active`, `has_opt_in`)
   - Timestamps: sufixo `_at` (`created_at`, `last_message_at`)

---

## 2. Schema lógico em domínios

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PLATFORM                                    │
│  workspaces · members · auth_users · api_keys                       │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
       ┌───────────────┼─────────────────────────────┐
       │               │                              │
┌──────▼──────┐  ┌─────▼──────┐               ┌──────▼──────────┐
│   ORG        │  │  CONTACTS   │               │   BILLING       │
│ departments  │  │  contacts   │               │ plans · subs    │
│ teams        │  │ contact_tags│               │ usage           │
│ team_members │  │ contact_*   │               └─────────────────┘
└──────┬───────┘  └────┬────────┘
       │               │
       │      ┌────────┘
       │      │
┌──────▼──────▼─────────────────┐    ┌─────────────────────────┐
│      LIVECHAT                 │    │       AGENTS            │
│ channels · channel_secrets    │    │ agents · agent_templates│
│ conversations · messages      │◄───┤ tools · agent_tools     │
│ webhook_events                │    │ tool_logs · contexts    │
└──────┬─────────────────┬──────┘    └─────────────────────────┘
       │                 │
       │                 ▼
       │       ┌──────────────────┐      ┌─────────────────────┐
       │       │    PIPELINE      │      │   FLOW BUILDER      │
       │       │ pipelines·stages │      │ flows · executions  │
       │       │ deals · history  │◄─────┤ flow_logs · subs    │
       │       └──────────────────┘      └─────────────────────┘
       │
       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   CAMPAIGNS      │   │    CALENDAR      │   │   KNOWLEDGE      │
│ campaigns ·      │   │ calendars ·      │   │ kb_documents ·   │
│ campaign_steps   │   │ events ·         │   │ kb_chunks (pgv)  │
│ recipients ·     │   │ availability     │   │ kb_feedback      │
│ deliveries ·     │   │ exceptions       │   └──────────────────┘
│ followups        │   └──────────────────┘
└──────────────────┘
```

---

## 3. Domain: Platform (workspaces, members, auth)

### 3.1 `workspaces`

```sql
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  industry        text,                              -- enum-like, free text
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',
  locale          text NOT NULL DEFAULT 'pt-BR',
  logo_url        text,                              -- R2 key
  settings        jsonb NOT NULL DEFAULT '{}',       -- feature toggles, defaults
  plan_id         uuid REFERENCES plans(id) ON DELETE SET NULL,
  trial_ends_at   timestamptz,
  subscription_status text NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial','active','past_due','canceled','expired')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);

CREATE INDEX idx_workspaces_subscription_status ON workspaces(subscription_status);
```

### 3.2 `members`

Usuário interno de um workspace. Tabela separada de `auth_users` (provider externo).

```sql
CREATE TABLE members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  auth_user_id        uuid NOT NULL,                   -- ref a Supabase auth.users.id
  email               citext NOT NULL,
  name                text,
  phone               text,
  avatar_url          text,                            -- R2 key
  role                text NOT NULL
    CHECK (role IN ('OWNER','ADMIN','SUPERVISOR','AGENT','READONLY')),
  status              text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','inactive','blocked')),
  is_platform_admin   boolean NOT NULL DEFAULT false,  -- super-admin flag
  theme_preference    text DEFAULT 'dark'
    CHECK (theme_preference IN ('dark','light','system')),
  dashboard_layout    jsonb NOT NULL DEFAULT '{}',     -- preferências de dashboard pessoal (vide nota abaixo)
  notification_prefs  jsonb NOT NULL DEFAULT '{"in_app": true, "email": true, "push": false}',  -- MVP: global on/off por canal (PRD §3.3 #7); granular por tipo = fase 2
  density_preference  text DEFAULT 'comfortable'
    CHECK (density_preference IN ('comfortable','compact')),
  locale_override     text,                            -- NULL = herda do workspace
  is_online           boolean NOT NULL DEFAULT false,
  last_seen_at        timestamptz,
  invited_by          uuid REFERENCES members(id) ON DELETE SET NULL,
  invited_at          timestamptz,
  joined_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  UNIQUE (workspace_id, auth_user_id),
  UNIQUE (workspace_id, email)
);

CREATE INDEX idx_members_workspace ON members(workspace_id);
CREATE INDEX idx_members_auth_user ON members(auth_user_id);
CREATE INDEX idx_members_role ON members(workspace_id, role);

-- Shape esperado de `members.dashboard_layout` (validado por Zod no boundary; jsonb pra flexibilidade futura):
--   {
--     "hidden_cards":  string[],                                -- chaves dos cards escondidos pelo member
--     "pinned_cards":  string[],                                -- chaves dos cards pinados no topo
--     "card_order":    string[],                                -- ordem custom (sobrepõe default do role)
--     "default_period": "today" | "7d" | "30d" | "month" | "custom"
--   }
-- Member não pode esconder cards marcados como obrigatórios pelo ADMIN (enforcement no resolver server-side).

-- Shape esperado de `members.notification_prefs`:
--   {
--     "in_app": boolean,
--     "email": boolean,
--     "push": boolean       -- futuro; sempre false no MVP
--   }
-- Granularidade por tipo de evento fica para fase 2 (PRD §3.3 #7).
```

### 3.3 `api_keys`

```sql
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  key_hash        text NOT NULL UNIQUE,                 -- SHA-256 do token claro
  key_prefix      text NOT NULL,                        -- primeiros 8 chars para display
  scopes          text[] NOT NULL DEFAULT '{}',         -- ['read:conversations', ...]
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  is_active       boolean NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  expires_at      timestamptz,
  created_by      uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE INDEX idx_api_keys_workspace ON api_keys(workspace_id) WHERE is_active = true;
```

### 3.4 RLS sample

```sql
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_workspace_isolation ON members
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

(Mesma policy aplicada a TODA tabela com `workspace_id`.)

---

## 4. Domain: Org (departments, teams)

### 4.1 `departments`

```sql
CREATE TABLE departments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  color         text NOT NULL DEFAULT '#1FFF13',   -- hex
  icon          text,
  is_active     boolean NOT NULL DEFAULT true,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz,
  UNIQUE (workspace_id, name)
);
CREATE INDEX idx_departments_workspace ON departments(workspace_id);
```

### 4.2 `teams`

```sql
CREATE TABLE teams (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id         uuid REFERENCES departments(id) ON DELETE SET NULL,
  name                  text NOT NULL,
  description           text,
  is_active             boolean NOT NULL DEFAULT true,
  auto_assign           boolean NOT NULL DEFAULT false,
  max_concurrent_chats  integer DEFAULT 10,
  priority              integer NOT NULL DEFAULT 0,
  schedule              jsonb,                            -- {monday: {start: "09:00", end: "18:00"}, ...}
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz
);
CREATE INDEX idx_teams_workspace ON teams(workspace_id);
CREATE INDEX idx_teams_department ON teams(department_id) WHERE department_id IS NOT NULL;
```

### 4.3 `team_members`

```sql
CREATE TABLE team_members (
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  is_leader   boolean NOT NULL DEFAULT false,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, member_id)
);
CREATE INDEX idx_team_members_member ON team_members(member_id);
```

---

## 5. Domain: Contacts

### 5.1 `contacts`

```sql
CREATE TABLE contacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name        text,
  phone               text,                            -- MSISDN E.164 normalized
  email               citext,
  avatar_url          text,                            -- R2 key
  notes               text,
  language            text DEFAULT 'pt-BR',
  source              text,                            -- 'whatsapp', 'manual', 'api', 'campaign', etc.
  marketing_opt_in    boolean NOT NULL DEFAULT false,
  opt_in_method       text CHECK (opt_in_method IN
    ('whatsapp','website','checkout','import','manual','api') OR opt_in_method IS NULL),
  opt_in_source       text,                            -- "Black Friday Landing 2025"
  opt_in_at           timestamptz,
  opt_out_at          timestamptz,
  opt_out_reason      text,
  owner_id            uuid REFERENCES members(id) ON DELETE SET NULL,
  custom_fields       jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  deleted_at          timestamptz                      -- LGPD soft delete
);
CREATE UNIQUE INDEX uq_contacts_workspace_phone ON contacts(workspace_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_contacts_workspace_name ON contacts(workspace_id, lower(display_name));
CREATE INDEX idx_contacts_owner ON contacts(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_contacts_opt_in ON contacts(workspace_id, marketing_opt_in);
```

### 5.2 `tags` & `contact_tags`

```sql
CREATE TABLE tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text NOT NULL DEFAULT '#1FFF13',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE contact_tags (
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  tagged_by     uuid REFERENCES members(id) ON DELETE SET NULL,
  tagged_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX idx_contact_tags_tag ON contact_tags(tag_id);
```

---

## 6. Domain: LiveChat

### 6.1 `channels` (substitui `inboxes` do v1)

`provider` é a identidade técnica do canal. Cobrindo no MVP: WhatsApp Cloud (Meta), Instagram Messaging (Meta — schema-ready no MVP, implementação completa em F1.5) e WAHA.

```sql
CREATE TABLE channels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('meta_whatsapp','meta_instagram','waha')),
  name                text NOT NULL,                  -- "Suporte WhatsApp Vendas" / "Instagram @loja"
  display_handle      text,                           -- número formatado (WA) ou @username (IG)

  -- WhatsApp Cloud
  phone_number        text,
  phone_number_id     text,                           -- Meta phone_number_id (raw)
  waba_id             text,                           -- Meta WABA ID

  -- Instagram Messaging (Meta)
  ig_user_id          text,                           -- Instagram Business Account ID
  ig_username         text,                           -- @handle
  ig_account_type     text CHECK (ig_account_type IN ('business','creator') OR ig_account_type IS NULL),
  fb_page_id          text,                           -- Facebook Page vinculada

  -- WAHA
  waha_session_id     text,

  -- Meta (compartilhado WA + IG): herdado do platform_secrets.meta_app_id;
  -- webhook_verify_token agora é único da plataforma, não por canal.
  webhook_verify_token text,                          -- DEPRECATED: manter por compatibilidade; novo path usa platform-level

  is_active           boolean NOT NULL DEFAULT true,
  is_default          boolean NOT NULL DEFAULT false,
  metadata            jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);
CREATE UNIQUE INDEX uq_channels_phone_number_id ON channels(phone_number_id) WHERE phone_number_id IS NOT NULL;
CREATE UNIQUE INDEX uq_channels_ig_user_id ON channels(ig_user_id) WHERE ig_user_id IS NOT NULL;
CREATE INDEX idx_channels_workspace ON channels(workspace_id);
CREATE INDEX idx_channels_provider ON channels(workspace_id, provider) WHERE is_active = true;

-- garante coerência: provider determina quais colunas DEVEM existir
ALTER TABLE channels ADD CONSTRAINT channels_provider_columns CHECK (
  (provider = 'meta_whatsapp'  AND phone_number_id IS NOT NULL AND waba_id IS NOT NULL)
  OR (provider = 'meta_instagram' AND ig_user_id IS NOT NULL AND fb_page_id IS NOT NULL)
  OR (provider = 'waha' AND waha_session_id IS NOT NULL)
);
```

### 6.2 `channel_secrets`

```sql
CREATE TABLE channel_secrets (
  channel_id          uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  access_token_enc    text NOT NULL,                  -- AES-256-GCM
  refresh_token_enc   text,
  app_secret_enc      text,
  api_key_enc         text,
  key_version         integer NOT NULL DEFAULT 1,     -- para rotação
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

### 6.3 `conversations`

```sql
CREATE TABLE conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  remote_id           text NOT NULL,                  -- WA: wa_id (MSISDN); IG DM: igsid; IG comment_thread: media_id
  kind                text NOT NULL DEFAULT 'direct'
    CHECK (kind IN ('direct','group','story_thread','comment_thread')),
  -- story_thread / comment_thread só fazem sentido em provider = meta_instagram.
  -- comment_thread: 1 conversation por (channel_id, media_id, contact_id). Histórico de comentários do mesmo contato no mesmo post agrupado.
  -- story_thread: opcional, geralmente story replies ficam em kind='direct' para não fragmentar histórico.
  status              text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending','closed','resolved','snoozed')),
  ai_mode             text NOT NULL DEFAULT 'off'
    CHECK (ai_mode IN ('off','on','paused')),
  assigned_to         uuid REFERENCES members(id) ON DELETE SET NULL,
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,
  team_id             uuid REFERENCES teams(id) ON DELETE SET NULL,
  agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  group_name          text,
  group_avatar_url    text,
  last_message_id     uuid,
  last_message_preview text,
  last_message_at     timestamptz,
  last_message_from   text CHECK (last_message_from IN ('contact','member','agent','system') OR last_message_from IS NULL),
  unread_count        integer NOT NULL DEFAULT 0,
  pinned              boolean NOT NULL DEFAULT false,
  snoozed_until       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);
CREATE UNIQUE INDEX uq_conversations_channel_remote ON conversations(channel_id, remote_id);
CREATE INDEX idx_conversations_workspace_status_lastmsg
  ON conversations(workspace_id, status, last_message_at DESC);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_conversations_department ON conversations(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX idx_conversations_agent ON conversations(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_conversations_contact ON conversations(contact_id) WHERE contact_id IS NOT NULL;
```

### 6.4 `messages`

```sql
CREATE TABLE messages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id         uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_id             text,                          -- wa_message_id (dedup)
  direction               text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type             text NOT NULL CHECK (sender_type IN ('contact','member','agent','system')),
  sender_member_id        uuid REFERENCES members(id) ON DELETE SET NULL,
  sender_agent_id         uuid REFERENCES agents(id) ON DELETE SET NULL,
  type                    text NOT NULL DEFAULT 'text'
    CHECK (type IN (
      -- comuns
      'text','image','video','audio','voice','document','sticker',
      'location','contact','interactive','template','reaction','system',
      -- Instagram-específicos
      'story_mention','story_reply','share','comment','comment_reply','ig_postback','referral'
    )),
  content                 text,                          -- texto puro (caption ou body)
  view_status             text NOT NULL DEFAULT 'pending'
    CHECK (view_status IN ('pending','sending','sent','delivered','read','failed','deleted')),
  failed_reason           text,
  media_url               text,                          -- R2 key (não URL pública)
  media_mime              text,
  media_size_bytes        bigint,
  media_sha256            text,
  media_caption           text,
  interactive_payload     jsonb,                         -- discriminated union no app: buttons | list | template
  reply_to_message_id     uuid REFERENCES messages(id) ON DELETE SET NULL,
  reaction_emoji          text,                          -- só para type='reaction'
  metadata                jsonb NOT NULL DEFAULT '{}',
  delivered_at            timestamptz,
  read_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz,
  deleted_at              timestamptz                    -- LGPD
);
CREATE UNIQUE INDEX uq_messages_external ON messages(conversation_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_workspace_created ON messages(workspace_id, created_at DESC);
```

**Sobre `interactive_payload`:** no v1 era `Record<string, any>` (FX-023d). No v2 ainda é JSONB no DB (necessário pela variedade), mas TIPADO no TypeScript via discriminated union em `packages/shared/src/types/interactive.ts`. Validar com Zod no insert/select boundary.

### 6.5 `webhook_events` (dedup de inbound)

```sql
CREATE TABLE webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  event_uid     text NOT NULL,                          -- unique do provider
  raw_payload   jsonb NOT NULL,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, event_uid)
);
CREATE INDEX idx_webhook_events_created ON webhook_events(created_at DESC);
```

### 6.6 `conversation_routing_history`

```sql
CREATE TABLE conversation_routing_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_department_id  uuid,
  to_department_id    uuid,
  from_team_id        uuid,
  to_team_id          uuid,
  from_member_id      uuid,
  to_member_id        uuid,
  routed_by           text NOT NULL CHECK (routed_by IN ('ai','manual','auto','escalation')),
  routed_by_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  reason              text,
  priority            text CHECK (priority IN ('low','normal','high','urgent') OR priority IS NULL),
  routed_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_routing_history_conv ON conversation_routing_history(conversation_id, routed_at DESC);
```

### 6.7 `conversation_notes`

```sql
CREATE TABLE conversation_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  body            text NOT NULL,
  mentions        uuid[] NOT NULL DEFAULT '{}',         -- member_ids
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);
CREATE INDEX idx_conversation_notes_conv ON conversation_notes(conversation_id, created_at DESC);
```

### 6.8 `ig_comments` (auxiliar para canais Instagram)

Comments em posts/reels do Instagram são entidades de primeira classe (precisam de ações de moderação: ocultar, deletar, private reply). Cada comment vira uma `messages` row (type=`comment` ou `comment_reply`) E uma `ig_comments` row com metadata específica.

```sql
CREATE TABLE ig_comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id          uuid REFERENCES messages(id) ON DELETE SET NULL,
  external_comment_id text NOT NULL,                          -- ID do comment no Graph
  parent_external_id  text,                                   -- comment pai (thread)
  media_id            text NOT NULL,                          -- post/reel
  media_kind          text CHECK (media_kind IN ('post','reel','story') OR media_kind IS NULL),
  from_ig_user_id     text NOT NULL,                          -- IGSID do autor
  from_username       text,
  text                text,
  hidden              boolean NOT NULL DEFAULT false,         -- POST /<comment_id>?hide=true
  deleted_at          timestamptz,
  private_reply_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  raw_payload         jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, external_comment_id)
);
CREATE INDEX idx_ig_comments_media ON ig_comments(channel_id, media_id, created_at DESC);
CREATE INDEX idx_ig_comments_conversation ON ig_comments(conversation_id) WHERE conversation_id IS NOT NULL;
```

Detalhe completo do fluxo em [`features/INSTAGRAM.md`](./features/INSTAGRAM.md) §7.

---

## 7. Domain: Agents (IA)

### 7.1 `agents`

```sql
CREATE TABLE agents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id             uuid REFERENCES agent_templates(id) ON DELETE SET NULL,
  name                    text NOT NULL,
  description             text,
  system_prompt           text NOT NULL,
  -- model: slug OpenRouter (ex: 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet').
  -- Resolução: o backend valida que o slug está em workspace_agent_policies.allowed_models
  -- (ou no allowlist do plano se policy não definir override). Slug não-permitido = erro 403.
  model                   text NOT NULL DEFAULT 'openai/gpt-4o-mini',
  model_params            jsonb NOT NULL DEFAULT '{}',
  -- vision_model / transcription_model continuam apontando para modelos OpenAI direto
  -- porque OpenRouter NÃO roteia embeddings/transcription/vision-as-a-service.
  vision_model            text DEFAULT 'gpt-4o',
  transcription_model     text DEFAULT 'whisper-1',
  status                  text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','archived')),
  aggregation_enabled     boolean NOT NULL DEFAULT true,
  aggregation_window_sec  integer NOT NULL DEFAULT 20,
  max_batch_messages      integer NOT NULL DEFAULT 20,
  reply_if_idle_sec       integer,                       -- null = sem auto follow-up
  allow_handoff           boolean NOT NULL DEFAULT true,
  ignore_group_messages   boolean NOT NULL DEFAULT true,
  enabled_channel_ids     uuid[] NOT NULL DEFAULT '{}',  -- vazio = todos
  api_token_hash          text,                          -- token tipo API key, opcional
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz
);
CREATE INDEX idx_agents_workspace_status ON agents(workspace_id, status);
CREATE INDEX idx_agents_template ON agents(template_id) WHERE template_id IS NOT NULL;
```

### 7.2 `agent_templates`

```sql
CREATE TABLE agent_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid REFERENCES workspaces(id) ON DELETE CASCADE,  -- NULL = global
  key                 text NOT NULL,
  name                text NOT NULL,
  category            text,
  description         text,
  prompt_template     text NOT NULL,
  default_model       text NOT NULL,
  default_model_params jsonb NOT NULL DEFAULT '{}',
  default_tools       text[] NOT NULL DEFAULT '{}',     -- tool keys
  industry            text,
  is_global           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  UNIQUE (workspace_id, key)
);
CREATE INDEX idx_agent_templates_global ON agent_templates(is_global) WHERE is_global = true;
```

### 7.3 `agent_template_questions`

```sql
CREATE TABLE agent_template_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES agent_templates(id) ON DELETE CASCADE,
  key           text NOT NULL,
  label         text NOT NULL,
  type          text NOT NULL CHECK (type IN ('text','textarea','select','number','boolean','multiselect')),
  required      boolean NOT NULL DEFAULT false,
  help          text,
  options       jsonb NOT NULL DEFAULT '[]',
  position      integer NOT NULL DEFAULT 0,
  UNIQUE (template_id, key)
);
```

### 7.4 `tools`

```sql
CREATE TABLE tools (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,  -- NULL = global
  key             text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL,
  category        text NOT NULL CHECK (category IN ('database','http','workflow','calendar','knowledge')),
  schema          jsonb NOT NULL,                       -- OpenAI function schema
  handler_config  jsonb NOT NULL DEFAULT '{}',          -- table, action, columns, etc.
  is_global       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  UNIQUE (workspace_id, key)
);
CREATE INDEX idx_tools_global ON tools(is_global) WHERE is_global = true;
```

### 7.5 `agent_tools`

```sql
CREATE TABLE agent_tools (
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id       uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  is_enabled    boolean NOT NULL DEFAULT true,
  overrides     jsonb NOT NULL DEFAULT '{}',                                       -- overrides do handler_config base (ex: ajustar timeout, restringir mais)
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tool_id)
);

-- Shape esperado de `tools.handler_config` (jsonb) — column-level ACL para tools categoria 'database':
--   {
--     "table":              "contacts" | "deals" | ...,
--     "action":             "select" | "update" | "insert",
--     "allowed_columns": {
--       "read":             string[],                    -- colunas que tool pode LER
--       "write":            string[]                     -- colunas que tool pode ESCREVER
--     },
--     "restricted_columns": string[],                    -- colunas explicitamente bloqueadas (precedência sobre allowed)
--     "required_columns":   string[],                    -- colunas obrigatórias em insert/update
--     "requires_human_approval": boolean,                -- ativa interrupt LangGraph (só workflow tools)
--     "timeout_ms":         integer
--   }
-- `agent_tools.overrides` segue o mesmo shape parcial e faz deep-merge sobre `tools.handler_config` no boot do runtime.

### 7.6 `tool_logs`

```sql
CREATE TABLE tool_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES agents(id) ON DELETE SET NULL,
  tool_id         uuid NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  execution_id    uuid,                                 -- agent execution correlation
  action          text NOT NULL,                        -- 'select','update','insert','http','workflow'
  table_name      text,
  columns_accessed text[],
  params          jsonb NOT NULL,
  result          jsonb,
  error           text,
  duration_ms     integer,
  executed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tool_logs_workspace_executed ON tool_logs(workspace_id, executed_at DESC);
CREATE INDEX idx_tool_logs_agent ON tool_logs(agent_id, executed_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_tool_logs_conversation ON tool_logs(conversation_id) WHERE conversation_id IS NOT NULL;
```

### 7.7 `agent_executions` (checkpoint LangGraph)

```sql
CREATE TABLE agent_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  thread_id       text NOT NULL,                        -- LangGraph thread_id
  status          text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','interrupted','completed','failed')),
  current_node    text,
  state           jsonb NOT NULL,                       -- snapshot do StateGraph state
  total_tokens    integer DEFAULT 0,
  total_cost_usd  numeric(10,6) DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  completed_at    timestamptz,
  error           text
);
CREATE INDEX idx_agent_executions_thread ON agent_executions(thread_id);
CREATE INDEX idx_agent_executions_conversation ON agent_executions(conversation_id) WHERE conversation_id IS NOT NULL;
```

(Tabela auxiliar `agent_checkpoints` para LangGraph PostgresCheckpointer — schema é prescrito pela lib, gera-se via init script.)

### 7.8 `agent_metrics`

Agregação diária/semanal/mensal por agente.

```sql
CREATE TABLE agent_metrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id            uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  period              text NOT NULL CHECK (period IN ('day','week','month')),
  period_start        date NOT NULL,
  total_conversations integer NOT NULL DEFAULT 0,
  total_messages      integer NOT NULL DEFAULT 0,
  total_tokens        bigint NOT NULL DEFAULT 0,
  total_cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  avg_latency_ms      integer DEFAULT 0,
  handoff_count       integer NOT NULL DEFAULT 0,
  error_count         integer NOT NULL DEFAULT 0,
  UNIQUE (agent_id, period, period_start)
);
CREATE INDEX idx_agent_metrics_workspace_period ON agent_metrics(workspace_id, period, period_start DESC);
```

### 7.9 `llm_usage_logs` (cost tracking detalhado — multi-provider via OpenRouter)

Substitui `openai_usage_logs` do v1. Cobre chat (via OpenRouter) **e** chamadas diretas a OpenAI (embeddings, transcription, vision, TTS — coisas que OpenRouter não roteia).

```sql
CREATE TABLE llm_usage_logs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id                uuid REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  execution_id            uuid,                                                  -- agent_executions correlation
  request_type            text NOT NULL CHECK (request_type IN ('chat','transcription','vision','embedding','tts','dalle','rerank')),

  -- Roteador (chat sempre via openrouter; outros direto)
  router                  text NOT NULL DEFAULT 'openrouter'
    CHECK (router IN ('openrouter','openai_direct')),

  -- Identificadores OpenRouter
  openrouter_generation_id text,                                                  -- ID retornado pela OpenRouter; permite buscar trace completo no painel deles
  upstream_provider        text,                                                  -- provider real consumido por trás do OpenRouter (openai|anthropic|google|...)
  model                    text NOT NULL,                                         -- slug OpenRouter (ex: 'openai/gpt-4o-mini') ou OpenAI direto (ex: 'text-embedding-3-small')

  -- Uso e custo
  prompt_tokens            integer NOT NULL DEFAULT 0,
  completion_tokens        integer NOT NULL DEFAULT 0,
  reasoning_tokens         integer NOT NULL DEFAULT 0,                            -- modelos o1/o3 etc
  total_tokens             integer NOT NULL DEFAULT 0,
  cost_usd                 numeric(12,8) NOT NULL DEFAULT 0,
  latency_ms               integer,
  finish_reason            text,                                                  -- stop/length/tool_calls/content_filter

  metadata                 jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_llm_usage_workspace_created ON llm_usage_logs(workspace_id, created_at DESC);
CREATE INDEX idx_llm_usage_model_created ON llm_usage_logs(model, created_at DESC);
CREATE INDEX idx_llm_usage_agent_created ON llm_usage_logs(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_llm_usage_openrouter_generation ON llm_usage_logs(openrouter_generation_id) WHERE openrouter_generation_id IS NOT NULL;
```

### 7.10 `workspace_agent_policies` (super-admin: limites de IA por workspace)

Toda chamada ao `agent-runtime` carrega um snapshot dessa policy. Definida por super-admin (override de defaults vindos do `plan`).

```sql
CREATE TABLE workspace_agent_policies (
  workspace_id              uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Modelos permitidos (slugs OpenRouter). Vazio = herda allow-list do plano.
  allowed_models            text[] NOT NULL DEFAULT '{}',
  default_chat_model        text,                                                 -- modelo default ao criar agent novo

  -- Features LangGraph
  allow_streaming           boolean NOT NULL DEFAULT true,
  allow_interrupts          boolean NOT NULL DEFAULT false,                       -- human-in-the-loop
  allow_parallel_tools      boolean NOT NULL DEFAULT true,
  allow_vision              boolean NOT NULL DEFAULT false,
  allow_transcription       boolean NOT NULL DEFAULT false,
  allow_persistent_checkpoints boolean NOT NULL DEFAULT true,
  allow_agent_conversions   boolean NOT NULL DEFAULT false,                       -- agente pode registrar conversion_events; default OFF por segurança (envolve $$)
  agent_conversion_require_approval boolean NOT NULL DEFAULT true,                -- se allow=true e require_approval=true → interrupt LangGraph pede confirmação humana

  -- Limites operacionais
  max_iterations            integer NOT NULL DEFAULT 5,
  max_tools_per_agent       integer NOT NULL DEFAULT 20,
  max_tokens_per_call       integer NOT NULL DEFAULT 8000,
  max_monthly_cost_usd      numeric(10,2),                                        -- NULL = sem cap (uso interno)
  max_daily_invocations     integer,

  -- Categorias de tools permitidas (subset de {database,http,workflow,calendar,knowledge})
  allowed_tool_categories   text[] NOT NULL DEFAULT ARRAY['database','workflow','calendar','knowledge'],

  -- Audit
  updated_by                uuid REFERENCES members(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
```

Endpoint `PATCH /platform/workspaces/:id/agent-policy` exclusivo de `is_platform_admin=true`.

### 7.11 `llm_models_whitelist` (plataforma: catálogo global de modelos)

Synced periodicamente da OpenRouter `GET /api/v1/models`. Super-admin marca quais entram no catálogo da plataforma.

```sql
CREATE TABLE llm_models_whitelist (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE,                                    -- 'openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'
  display_name            text NOT NULL,
  upstream_provider       text NOT NULL,                                           -- 'openai','anthropic','google','meta','mistral'
  context_length          integer,
  supports_tools          boolean NOT NULL DEFAULT true,
  supports_vision         boolean NOT NULL DEFAULT false,
  supports_streaming      boolean NOT NULL DEFAULT true,
  pricing_prompt_per_1m   numeric(12,6),                                           -- USD por 1M prompt tokens (snapshot)
  pricing_completion_per_1m numeric(12,6),
  is_active               boolean NOT NULL DEFAULT true,                           -- super-admin pode esconder
  default_plan_keys       text[] NOT NULL DEFAULT '{}',                            -- planos que herdam esse modelo automaticamente
  notes                   text,
  synced_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz
);
CREATE INDEX idx_llm_models_active ON llm_models_whitelist(is_active) WHERE is_active = true;
```

### 7.12 `platform_secrets` (super-admin: secrets de plataforma cifrados)

Secrets compartilhados por toda a plataforma (não por workspace). Cifrados com AES-256-GCM versionado.

```sql
CREATE TABLE platform_secrets (
  key                     text PRIMARY KEY,                                        -- 'openrouter_api_key','meta_app_secret','meta_app_id','meta_webhook_verify_token','openai_api_key','encryption_key_active_version'
  value_enc               text NOT NULL,                                           -- cifrado com KMS local; uso operacional via cache em-memória
  key_version             integer NOT NULL DEFAULT 1,                              -- incrementa a cada rotação; usado em logs de auditoria
  description             text,
  rotated_at              timestamptz NOT NULL DEFAULT now(),
  rotated_by              uuid REFERENCES members(id) ON DELETE SET NULL,
  previous_value_enc      text,                                                    -- guarda apenas a versão imediatamente anterior pra rollback emergencial
  previous_key_version    integer,
  updated_at              timestamptz NOT NULL DEFAULT now()
);
```

**Rotação:** `UPDATE platform_secrets SET previous_value_enc=value_enc, previous_key_version=key_version, value_enc=$new, key_version=key_version+1, rotated_at=now(), rotated_by=$member` em transaction. Audit log registra `platform_secret.rotated` com `from_version`/`to_version`. Rollback é re-aplicar `previous_value_enc` numa segunda rotação manual.

Acesso protegido por `is_platform_admin=true`. Auditoria em `audit_logs` com `resource_type='platform_secret'`.

---

## 8. Domain: Knowledge Base (RAG com pgvector)

### 8.1 `kb_documents`

```sql
CREATE TABLE kb_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title               text NOT NULL,
  source              text NOT NULL CHECK (source IN ('upload','url','manual')),
  source_url          text,
  source_mime         text,
  category            text,
  tags                text[] NOT NULL DEFAULT '{}',
  language            text NOT NULL DEFAULT 'pt-BR',
  priority            integer NOT NULL DEFAULT 5,
  status              text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','draft','archived')),
  visible_to_agents   boolean NOT NULL DEFAULT true,
  raw_content         text NOT NULL,                    -- markdown/texto original
  content_sha256      text NOT NULL,                    -- dedup
  version             integer NOT NULL DEFAULT 1,
  created_by          uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);
CREATE INDEX idx_kb_documents_workspace_status ON kb_documents(workspace_id, status);
CREATE INDEX idx_kb_documents_category ON kb_documents(workspace_id, category) WHERE category IS NOT NULL;
```

### 8.2 `kb_chunks` (com pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE kb_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index     integer NOT NULL,
  content         text NOT NULL,
  content_tokens  integer NOT NULL,
  embedding       vector(1536),                          -- text-embedding-3-small
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

-- HNSW index para vector search
CREATE INDEX idx_kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_kb_chunks_workspace ON kb_chunks(workspace_id);

-- Para full-text search fallback (português)
CREATE INDEX idx_kb_chunks_fts_pt
  ON kb_chunks USING gin (to_tsvector('portuguese', content));
```

### 8.3 `kb_feedback`

```sql
CREATE TABLE kb_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_id        uuid REFERENCES kb_chunks(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  helpful         boolean NOT NULL,                     -- true = útil, false = não
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_feedback_document ON kb_feedback(document_id, created_at DESC);
```

---

## 9. Domain: Flow Builder

### 9.1 `flows`

```sql
CREATE TABLE flows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','archived')),
  trigger_type    text NOT NULL
    CHECK (trigger_type IN ('manual','stage_change','tag_added','keyword','new_lead','new_message','system_event','flow_submission')),
  trigger_config  jsonb NOT NULL DEFAULT '{}',
  filter_status   text[],                              -- conversation status filter
  filter_stage_ids uuid[],
  filter_tag_ids  uuid[],
  channel_ids     uuid[],                              -- vazio = todos
  nodes           jsonb NOT NULL DEFAULT '[]',         -- array de FlowNode
  edges           jsonb NOT NULL DEFAULT '[]',         -- array de FlowEdge
  schema_version  integer NOT NULL DEFAULT 1,
  manual_position integer,                              -- para drag-and-drop manual flows
  created_by      uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);
CREATE INDEX idx_flows_workspace_status ON flows(workspace_id, status);
CREATE INDEX idx_flows_trigger_type ON flows(workspace_id, trigger_type) WHERE status = 'active';
```

### 9.2 `flow_versions` (snapshot ao publicar)

```sql
CREATE TABLE flow_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  nodes           jsonb NOT NULL,
  edges           jsonb NOT NULL,
  trigger_config  jsonb NOT NULL,
  published_by    uuid REFERENCES members(id) ON DELETE SET NULL,
  published_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version)
);
```

Executações em curso usam o `flow_version_id` que estava ativo quando dispararam — mudanças no flow não afetam execuções já rodando.

### 9.3 `flow_executions`

```sql
CREATE TABLE flow_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flow_id         uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_version_id uuid NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  triggered_by    text NOT NULL CHECK (triggered_by IN ('manual','automatic','api')),
  triggered_by_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','waiting','completed','failed','cancelled')),
  current_node_id text,
  variables       jsonb NOT NULL DEFAULT '{}',
  next_step_at    timestamptz,
  last_error      text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  completed_at    timestamptz
);
CREATE INDEX idx_flow_executions_status_next
  ON flow_executions(status, next_step_at)
  WHERE status = 'waiting' AND next_step_at IS NOT NULL;
CREATE INDEX idx_flow_executions_workspace_status ON flow_executions(workspace_id, status);
CREATE INDEX idx_flow_executions_conversation ON flow_executions(conversation_id) WHERE conversation_id IS NOT NULL;
```

### 9.4 `flow_logs`

```sql
CREATE TABLE flow_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_id    uuid NOT NULL REFERENCES flow_executions(id) ON DELETE CASCADE,
  node_id         text NOT NULL,
  node_type       text NOT NULL,
  level           text NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message         text,
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flow_logs_execution_created ON flow_logs(execution_id, created_at);
```

### 9.5 `flow_submissions` (Meta Flows)

```sql
CREATE TABLE flow_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id      uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  meta_flow_id    text NOT NULL,                       -- ID Meta-side
  external_id     text,                                -- wamid do reply
  response        jsonb NOT NULL,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_flow_submissions_workspace_created ON flow_submissions(workspace_id, created_at DESC);
```

---

## 10. Domain: Pipeline (Funil unificado)

### 10.1 `pipelines`

```sql
CREATE TABLE pipelines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  industry        text,                                -- 'sales','support','operations','solar','construction',...
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);
CREATE INDEX idx_pipelines_workspace ON pipelines(workspace_id);
```

### 10.2 `stages`

Resolve a dupla estrutura do v1 (`kanban_columns` legacy + `project_stages` novo).

```sql
CREATE TABLE stages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id         uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name                text NOT NULL,
  color               text NOT NULL DEFAULT '#1FFF13',
  icon                text,
  position            integer NOT NULL,
  is_won              boolean NOT NULL DEFAULT false,  -- "Fechado ganho"
  is_lost             boolean NOT NULL DEFAULT false,  -- "Perdido"
  probability         numeric(5,2),                    -- 0-100, opcional
  automation_rules    jsonb NOT NULL DEFAULT '[]',     -- ver schema abaixo
  transition_rules    jsonb NOT NULL DEFAULT '{}',     -- required_fields, allowed_from, etc.
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  UNIQUE (pipeline_id, position)
);
CREATE INDEX idx_stages_pipeline ON stages(pipeline_id, position);
```

**Schema de `automation_rules` (JSONB):**

```jsonc
[
  {
    "id": "rule-uuid",
    "trigger": "on_enter" | "on_exit" | "on_stale",
    "action": "trigger_flow" | "send_message" | "notify_members" | "create_event" | "add_tag",
    "config": { /* depende da action */ },
    "delay_seconds": 0,
    "enabled": true
  }
]
```

**Schema de `transition_rules` (JSONB):**

```jsonc
{
  "allowed_from_stage_ids": ["uuid", "..."], // vazio = todos
  "required_fields": ["custom_field_key", "..."],
  "required_role": ["MANAGER", "ADMIN"],
  "requires_approval": false
}
```

### 10.3 `deals`

```sql
CREATE TABLE deals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_id         uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id            uuid NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
  contact_id          uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,
  title               text NOT NULL,
  value_cents         bigint NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'BRL',
  source              text,
  owner_id            uuid REFERENCES members(id) ON DELETE SET NULL,
  custom_fields       jsonb NOT NULL DEFAULT '{}',
  notes               text,
  position            integer NOT NULL DEFAULT 0,       -- posição dentro do stage
  closed_at           timestamptz,
  closed_won          boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);
CREATE INDEX idx_deals_workspace_pipeline_stage ON deals(workspace_id, pipeline_id, stage_id, position);
CREATE INDEX idx_deals_contact ON deals(contact_id);
CREATE INDEX idx_deals_owner ON deals(owner_id) WHERE owner_id IS NOT NULL;
```

### 10.4 `deal_history` (event sourcing)

```sql
CREATE TABLE deal_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type      text NOT NULL CHECK (event_type IN ('created','stage_changed','field_updated','owner_changed','closed','reopened','note_added','attachment_added')),
  from_value      jsonb,
  to_value        jsonb,
  actor_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  actor_type      text NOT NULL DEFAULT 'member' CHECK (actor_type IN ('member','agent','system','api')),
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_history_deal_created ON deal_history(deal_id, created_at DESC);
```

### 10.5 `deal_attachments` (com EXIF/GPS metadata, do v1 CardImageCapture)

```sql
CREATE TABLE deal_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  storage_key     text NOT NULL,                       -- R2 key
  mime            text NOT NULL,
  size_bytes      bigint NOT NULL,
  filename        text,
  caption         text,
  sha256          text NOT NULL,
  gps_lat         numeric(10,7),
  gps_lon         numeric(10,7),
  gps_altitude    numeric(8,2),
  gps_accuracy    numeric(8,2),
  captured_at     timestamptz,
  uploaded_by     uuid REFERENCES members(id) ON DELETE SET NULL,
  index_number    integer,                             -- número que aparece overlay (v1 feature)
  metadata        jsonb NOT NULL DEFAULT '{}',         -- city, state, address, country
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_attachments_deal ON deal_attachments(deal_id, created_at DESC);
```

### 10.6 ~~`deal_tasks`~~ — **REMOVIDO**

Sistema de tarefas (nem módulo independente, nem sub-recurso de deal) foi removido do escopo do v2 (decisão PRD §3.3 #1). Se voltar à pauta, será novo módulo desenhado do zero, não bolt-on.

### 10.7 `conversion_types` e `conversion_events` (sistema de conversões)

Sistema de gestão de conversões — lacuna grande do v1 (não existia). Detalhe e UX em [`features/DASHBOARD.md`](./features/DASHBOARD.md) §13.

```sql
CREATE TABLE conversion_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key             text NOT NULL,                              -- slug (ex: 'visita_agendada')
  label           text NOT NULL,                              -- "Visita agendada"
  color           text NOT NULL DEFAULT '#1FFF13',
  icon            text,
  value_required  boolean NOT NULL DEFAULT false,             -- true se digita valor obrigatório
  value_label     text,                                       -- "Valor da venda"
  currency        text NOT NULL DEFAULT 'BRL',
  is_default      boolean NOT NULL DEFAULT false,             -- selecionado primeiro na modal
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  UNIQUE (workspace_id, key)
);
CREATE INDEX idx_conversion_types_workspace ON conversion_types(workspace_id) WHERE is_active = true;

CREATE TABLE conversion_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversion_type_id      uuid NOT NULL REFERENCES conversion_types(id) ON DELETE RESTRICT,
  contact_id              uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  deal_id                 uuid REFERENCES deals(id) ON DELETE SET NULL,
  value_cents             bigint,
  currency                text NOT NULL DEFAULT 'BRL',
  note                    text,
  source                  text NOT NULL
    CHECK (source IN ('manual','deal_won','tag_added','agent_tool','api','webhook','flow')),
  triggered_by_member_id  uuid REFERENCES members(id) ON DELETE SET NULL,
  triggered_by_agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  triggered_by_flow_id    uuid REFERENCES flows(id) ON DELETE SET NULL,
  attributed_campaign_id  uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  attributed_channel_id   uuid REFERENCES channels(id) ON DELETE SET NULL,
  attribution_window_days integer NOT NULL DEFAULT 30,
  occurred_at             timestamptz NOT NULL DEFAULT now(),
  cancelled_at            timestamptz,
  cancelled_reason        text,
  metadata                jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_events_workspace_occurred
  ON conversion_events(workspace_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
CREATE INDEX idx_conv_events_member
  ON conversion_events(triggered_by_member_id, occurred_at DESC)
  WHERE cancelled_at IS NULL AND triggered_by_member_id IS NOT NULL;
CREATE INDEX idx_conv_events_agent
  ON conversion_events(triggered_by_agent_id, occurred_at DESC)
  WHERE cancelled_at IS NULL AND triggered_by_agent_id IS NOT NULL;
CREATE INDEX idx_conv_events_type
  ON conversion_events(conversion_type_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
CREATE INDEX idx_conv_events_attribution_campaign
  ON conversion_events(attributed_campaign_id, occurred_at DESC)
  WHERE cancelled_at IS NULL AND attributed_campaign_id IS NOT NULL;
CREATE INDEX idx_conv_events_contact
  ON conversion_events(contact_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;

-- Prevenção de duplicata casual: mesmo contato + tipo + dia
CREATE UNIQUE INDEX uq_conv_events_dedup
  ON conversion_events(workspace_id, contact_id, conversion_type_id, date_trunc('day', occurred_at))
  WHERE cancelled_at IS NULL;
```

**Stage automation hook:** `stages.automation_rules` ganha trigger novo `on_enter → action: 'register_conversion'` com config `{ conversion_type_key, value_from: 'deal' | 'fixed' | 'custom_field:<key>' }`. Implementação via flow-engine handler `register_conversion`.

**Tag-based hook:** nova tabela auxiliar `conversion_tag_triggers (workspace_id, tag_id, conversion_type_id)` indica quais tags disparam conversão automática quando aplicadas ao contato (trigger Postgres em `contact_tags` insert).

---

## 11. Domain: Campaigns

### 11.1 `campaigns`

```sql
CREATE TABLE campaigns (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id              uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  name                    text NOT NULL,
  type                    text NOT NULL CHECK (type IN ('broadcast','drip','triggered')),
  status                  text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
  start_at                timestamptz,
  end_at                  timestamptz,
  timezone                text NOT NULL DEFAULT 'America/Sao_Paulo',
  send_windows            jsonb NOT NULL DEFAULT '{"enabled": false}',
  rate_limit_per_minute   integer NOT NULL DEFAULT 30,
  daily_limit             integer DEFAULT 1000,
  messages_sent_today     integer NOT NULL DEFAULT 0,
  last_daily_reset_at     timestamptz,
  next_tick_at            timestamptz,
  auto_handoff_on_reply   boolean NOT NULL DEFAULT true,
  ai_handoff_agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
  segment_id              uuid,                            -- futuro: segment table
  created_by              uuid REFERENCES members(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz
);
CREATE INDEX idx_campaigns_workspace_status ON campaigns(workspace_id, status);
CREATE INDEX idx_campaigns_running_tick ON campaigns(next_tick_at) WHERE status = 'running';
```

### 11.2 `campaign_steps`

```sql
CREATE TABLE campaign_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  position        integer NOT NULL,
  template_name   text NOT NULL,                       -- nome do template Meta
  language_code   text NOT NULL DEFAULT 'pt_BR',
  template_components jsonb NOT NULL DEFAULT '[]',     -- header, body, footer, buttons
  delay_seconds   integer NOT NULL DEFAULT 0,
  stop_on_reply   boolean NOT NULL DEFAULT true,
  UNIQUE (campaign_id, position)
);
```

### 11.3 `campaign_recipients`

```sql
CREATE TABLE campaign_recipients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id       uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','completed','responded','failed','opted_out')),
  last_step_index   integer DEFAULT -1,
  last_step_at      timestamptz,
  responded         boolean NOT NULL DEFAULT false,
  responded_at      timestamptz,
  failed_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX idx_campaign_recipients_status ON campaign_recipients(campaign_id, status);
```

### 11.4 `campaign_deliveries`

```sql
CREATE TABLE campaign_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id         uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id        uuid NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  step_id             uuid NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  message_id          uuid REFERENCES messages(id) ON DELETE SET NULL,
  external_id         text,                             -- wamid
  status              text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','read','failed','blocked')),
  idempotency_key     text NOT NULL UNIQUE,             -- sha256(campaign_id+contact_id+step_id)
  error_code          text,
  error_message       text,
  queued_at           timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz
);
CREATE INDEX idx_campaign_deliveries_campaign_status ON campaign_deliveries(campaign_id, status);
```

### 11.5 `campaign_metrics` (rolling snapshot)

```sql
CREATE TABLE campaign_metrics (
  campaign_id         uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  total_recipients    integer NOT NULL DEFAULT 0,
  messages_queued     integer NOT NULL DEFAULT 0,
  messages_sent       integer NOT NULL DEFAULT 0,
  messages_delivered  integer NOT NULL DEFAULT 0,
  messages_read       integer NOT NULL DEFAULT 0,
  messages_replied    integer NOT NULL DEFAULT 0,
  messages_failed     integer NOT NULL DEFAULT 0,
  messages_blocked    integer NOT NULL DEFAULT 0,
  delivery_rate       numeric(5,2),
  read_rate           numeric(5,2),
  response_rate       numeric(5,2),
  block_rate          numeric(5,2),
  health_status       text NOT NULL DEFAULT 'healthy'
    CHECK (health_status IN ('healthy','warning','critical')),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
```

### 11.6 `campaign_followups`

```sql
CREATE TABLE campaign_followups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  trigger_event   text NOT NULL CHECK (trigger_event IN ('on_reply','on_no_reply','on_delivered')),
  delay_minutes   integer NOT NULL DEFAULT 60,
  template_name   text NOT NULL,
  language_code   text NOT NULL DEFAULT 'pt_BR',
  template_components jsonb NOT NULL DEFAULT '[]',
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE (campaign_id, position)
);
```

---

## 12. Domain: Calendar

### 12.1 `calendars`

```sql
CREATE TABLE calendars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('personal','team','workspace')),
  owner_id        uuid REFERENCES members(id) ON DELETE SET NULL,
  team_id         uuid REFERENCES teams(id) ON DELETE SET NULL,
  color           text NOT NULL DEFAULT '#1FFF13',
  description     text,
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);
CREATE INDEX idx_calendars_workspace ON calendars(workspace_id);
CREATE INDEX idx_calendars_owner ON calendars(owner_id) WHERE owner_id IS NOT NULL;
```

### 12.2 `availability_rules`

```sql
CREATE TABLE availability_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name            text NOT NULL,
  day_of_week     integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  is_available    boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);
CREATE INDEX idx_availability_rules_member_day ON availability_rules(member_id, day_of_week);
```

### 12.3 `availability_exceptions`

```sql
CREATE TABLE availability_exceptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  start_time      time,
  end_time        time,
  is_all_day      boolean NOT NULL DEFAULT true,
  is_available    boolean NOT NULL DEFAULT false,       -- false = bloqueado
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_availability_exceptions_member_dates ON availability_exceptions(member_id, start_date, end_date);
```

### 12.4 `events`

```sql
CREATE TABLE events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  calendar_id       uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text,
  type              text NOT NULL DEFAULT 'meeting'
    CHECK (type IN ('meeting','demo','follow_up','task','reminder','other')),
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','confirmed','cancelled','completed')),
  location          text,
  meeting_url       text,
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id           uuid REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES members(id) ON DELETE SET NULL,
  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,  -- agente IA marcou
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz
);
CREATE INDEX idx_events_calendar_start ON events(calendar_id, start_at);
CREATE INDEX idx_events_workspace_start ON events(workspace_id, start_at);
CREATE INDEX idx_events_contact ON events(contact_id) WHERE contact_id IS NOT NULL;
```

### 12.5 `event_participants`

```sql
CREATE TABLE event_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES members(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'attendee' CHECK (role IN ('organizer','attendee')),
  rsvp            text DEFAULT 'pending' CHECK (rsvp IN ('pending','accepted','declined','tentative')),
  notified_at     timestamptz,
  CHECK (member_id IS NOT NULL OR contact_id IS NOT NULL)
);
CREATE INDEX idx_event_participants_event ON event_participants(event_id);
```

### 12.6 Função `compute_available_slots`

Replica do v1 (`020_compute_available_slots.sql`), adaptada para v2:

```sql
CREATE OR REPLACE FUNCTION compute_available_slots(
  p_workspace_id uuid,
  p_member_id uuid,
  p_date date,
  p_interval_minutes integer DEFAULT 60,
  p_min_notice_minutes integer DEFAULT 30,
  p_max_slots integer DEFAULT 10
)
RETURNS TABLE (start_at timestamptz, end_at timestamptz, duration_minutes integer)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- ... (lógica do v1, adaptada: cruzar availability_rules + availability_exceptions + events não-cancelados)
END;
$$;
```

(Implementação completa fica como tarefa de migration F0.)

---

## 13. Domain: Billing (feature flag)

### 13.1 `plans`

```sql
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,                 -- 'free','starter','pro','business'
  name            text NOT NULL,
  description     text,
  price_monthly_cents bigint NOT NULL DEFAULT 0,
  price_yearly_cents  bigint NOT NULL DEFAULT 0,
  limits          jsonb NOT NULL DEFAULT '{}',          -- {members, channels, agents, messages_per_month, storage_mb, contacts}
  features        jsonb NOT NULL DEFAULT '{}',          -- {api_access, webhooks, white_label, priority_support}
  stripe_product_id text,
  stripe_monthly_price_id text,
  stripe_yearly_price_id text,
  is_active       boolean NOT NULL DEFAULT true,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 13.2 `subscriptions`

(Existe mesmo sem Stripe ativo; campos Stripe ficam vazios)

```sql
CREATE TABLE subscriptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id                     uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                      text NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial','active','past_due','canceled','expired')),
  billing_cycle               text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly','yearly')),
  trial_ends_at               timestamptz,
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  cancel_at_period_end        boolean NOT NULL DEFAULT false,
  canceled_at                 timestamptz,
  stripe_customer_id          text,
  stripe_subscription_id      text,
  stripe_latest_invoice_id    text,
  custom_limits               jsonb,                    -- override por workspace
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz
);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### 13.3 `usage_tracking`

```sql
CREATE TABLE usage_tracking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric          text NOT NULL,                        -- 'messages_sent','agent_tokens','storage_bytes','contacts'
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  value           bigint NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, metric, period_start)
);
CREATE INDEX idx_usage_tracking_workspace_metric ON usage_tracking(workspace_id, metric, period_start DESC);
```

---

## 14. Domain: Audit & system

### 14.1 `audit_logs`

```sql
CREATE TABLE audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid REFERENCES workspaces(id) ON DELETE CASCADE,  -- null = platform-level
  actor_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  actor_type      text NOT NULL CHECK (actor_type IN ('member','agent','api','system','platform_admin')),
  action          text NOT NULL,                        -- 'workspace.create','member.invite','campaign.activate', etc.
  resource_type   text NOT NULL,
  resource_id     uuid,
  metadata        jsonb NOT NULL DEFAULT '{}',
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX idx_audit_logs_actor_created ON audit_logs(actor_member_id, created_at DESC) WHERE actor_member_id IS NOT NULL;
```

### 14.2 `notifications`

```sql
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type            text NOT NULL,                        -- 'mention','assignment','campaign_done','deal_closed', etc.
  title           text NOT NULL,
  body            text,
  link            text,
  metadata        jsonb,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_id, created_at DESC) WHERE read_at IS NULL;
```

### 14.3 `outbound_webhooks` (assinaturas de cliente)

```sql
CREATE TABLE outbound_webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  url             text NOT NULL,
  secret_enc      text NOT NULL,                        -- AES-256-GCM; usado pra HMAC do webhook
  events          text[] NOT NULL,                      -- ['message.received','message.sent',...]
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz
);

CREATE TABLE outbound_webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','retrying')),
  response_status integer,
  response_body   text,
  attempt         integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX idx_outbound_webhook_deliveries_pending
  ON outbound_webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending','retrying');
```

---

## 15. Materialized views (otimização de dashboards)

### 15.1 `mv_workspace_stats`

```sql
CREATE MATERIALIZED VIEW mv_workspace_stats AS
SELECT
  workspace_id,
  count(*) FILTER (WHERE status = 'open') AS open_conversations,
  count(*) FILTER (WHERE status = 'pending') AS pending_conversations,
  count(DISTINCT contact_id) AS unique_contacts,
  count(*) FILTER (WHERE last_message_at > now() - interval '24 hours') AS active_last_24h
FROM conversations
GROUP BY workspace_id;

CREATE UNIQUE INDEX ON mv_workspace_stats(workspace_id);
-- Refresh hourly via cron job:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_workspace_stats;
```

### 15.2 `mv_campaign_progress`

(Similar para campaign delivery progress.)

---

## 16. Triggers

### 16.1 `updated_at` automático

```sql
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Aplicar em toda tabela com updated_at:
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
-- (repetir para cada tabela com updated_at)
```

### 16.2 `deal_history` automático

Trigger em `deals` que insere em `deal_history` quando `stage_id` muda ou `owner_id` muda.

### 16.3 `conversation.last_message_*` automático

Trigger em `messages` (AFTER INSERT) que atualiza `conversations.last_message_*` correspondente.

---

## 17. Migrations: ordem sugerida

Numeração com prefixo `NNNN_` e nome descritivo. Cada arquivo é uma migration Drizzle:

```
0001_extensions.sql                      -- pgcrypto, vector, pg_trgm, citext
0002_platform_workspaces.sql             -- workspaces, members, auth abstraction
0003_org_departments_teams.sql
0004_contacts_tags.sql
0005_channels_secrets.sql                -- channels (meta_whatsapp + meta_instagram + waha) + channel_secrets
0006_conversations_messages.sql          -- kind: direct/group/story_thread/comment_thread; type: + story_mention/share/comment/...
0007_conversation_notes_routing.sql
0008_ig_comments.sql                     -- tabela auxiliar moderação Instagram
0009_agents_templates_tools.sql          -- agents.model = slug OpenRouter
0010_agent_executions_metrics.sql
0011_llm_router_tables.sql               -- llm_usage_logs (substitui openai_usage_logs), llm_models_whitelist, platform_secrets, workspace_agent_policies
0012_knowledge_base.sql                  -- com pgvector index
0013_flows_versions_executions.sql
0014_flow_submissions.sql
0015_pipelines_stages_deals.sql
0016_deal_history_attachments.sql        -- sem deal_tasks (removido do escopo)
0016a_conversion_types_events.sql        -- conversion_types + conversion_events + conversion_tag_triggers
0017_campaigns_steps_recipients.sql
0018_campaign_deliveries_metrics.sql
0019_calendars_availability_events.sql
0020_billing_plans_subscriptions.sql
0021_audit_notifications_webhooks.sql
0022_materialized_views.sql
0023_rls_policies.sql                    -- TODAS as RLS de uma vez
0024_triggers.sql                        -- updated_at, deal_history, last_message
0025_seed_global_templates.sql           -- 5 agent templates + tools globais + seed inicial llm_models_whitelist
0026_langgraph_checkpoint_setup.sql      -- LangGraph PostgresSaver tables (gerado por checkpointer.setup() do Python; checked in)
```

---

## 18. Convenções Drizzle

Em `packages/db/src/schema/<domain>.ts`:

```ts
import { pgTable, uuid, text, timestamp, boolean, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  // ...
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
```

Tipos inferidos pelo Drizzle. Schema Zod gerado via `drizzle-zod`:

```ts
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
export const workspaceInsertSchema = createInsertSchema(workspaces);
```

---

## 19. Diferenças explícitas vs v1

| v1 | v2 | Por quê |
|---|---|---|
| Campos PII em chats em texto plano | Tudo cifrado at rest via R2 (mídia) + colunas cifradas para tokens | Compliance, segurança |
| `chats.kanban_column_id` (typo `colum`) | `deals.stage_id` | Conceitualmente outro modelo (deals separados de conversations) |
| `chats.ai_agent_id` + `chats.assignee_agent` | `conversations.agent_id` + `conversations.assigned_to` (membro) | Naming claro: agent é IA, member é humano |
| `chats.status='AI'` | `conversations.status='open'` + `conversations.ai_mode='on'` | Ortogonal: status do atendimento ≠ modo IA |
| `contacts` table single (com confusão Contact/Customer) | `contacts` única e clara | Sem alias |
| `customer_tags` + `customers` | `contact_tags` + `contacts` | Naming consistente |
| `users` table + `members` indireto | `members` table direta | members = pertencente a workspace |
| `inboxes` | `channels` | Mais geral |
| `chat_messages.interactive_content: Record<string, any>` | `messages.interactive_payload jsonb` validado por Zod no boundary | Tipado no app |
| 47 migrations + 30 ad-hoc | ~22 migrations versionadas | Disciplina |
| Sem RLS | RLS em TUDO com workspace_id | Multi-tenancy mais segura |
| Sem `flow_versions` | `flow_versions` com snapshot ao publicar | Execuções não quebram com edição |
| `agent_tool_logs` separado | `tool_logs` unificado por categoria | Mesmo modelo para todas tools |
| Knowledge base sem embeddings | `kb_chunks` com pgvector HNSW | RAG real |
| `kanban_boards` + `kanban_columns` + `project_stages` (2 estruturas) | `pipelines` + `stages` única | Resolve dupla estrutura |
| `chat_attachments` table (legacy) | `messages.media_*` colunas direto (single source) | Sem dupla representação de mídia |
| `channels.provider IN ('meta_cloud','waha')` | `channels.provider IN ('meta_whatsapp','meta_instagram','waha')` + colunas IG-específicas | Provider Meta agora se desambigua entre os dois produtos; preparado para Tech Provider unificado |
| `openai_usage_logs` (apenas OpenAI) | `llm_usage_logs` com `router='openrouter'\|'openai_direct'` + `openrouter_generation_id` + `upstream_provider` | Multi-provider via OpenRouter desde o MVP; visibilidade de qual modelo real consumiu |
| Sem tabela de policy por workspace | `workspace_agent_policies` + `llm_models_whitelist` + `platform_secrets` | Super-admin controla per-workspace o que cada cliente pode usar |
| `agents.model` valor curto (`'gpt-4o-mini'`) | `agents.model` slug OpenRouter (`'openai/gpt-4o-mini'`) | Compatível com roteador |
| `tasks` + `deal_tasks` tabelas | — | Sistema de tarefas removido do escopo do v2 (PRD §3.3 #1) |
| `projects` + `project_*` tabelas | — | Sistema de Projects removido; nicho-awareness vive em `agent_templates.industry` + `pipelines.industry` (PRD §3.3 #2 e #4) |

---

## 20. Anti-patterns proibidos no schema

- ❌ `enum_type` Postgres ENUM — usar `text` + CHECK
- ❌ `serial`/`bigserial` PK — usar `uuid DEFAULT gen_random_uuid()`
- ❌ Tabela sem `workspace_id` quando tem dados de tenant (exceto `auth_users`, `plans`)
- ❌ Foreign key sem `ON DELETE` explícito
- ❌ Coluna nullable que poderia ter default não-null
- ❌ `jsonb` para algo que tem shape fixo conhecido
- ❌ Coluna em camelCase
- ❌ Migration que altera tipo de coluna sem migração de dados

---

## 21. Próximos passos

1. Revisar nomes de tabelas/colunas com Rogério.
2. Decidir items §3.3 do PRD (Tasks separadas? Projects? Documents?).
3. Após aprovação, gerar schema Drizzle em `packages/db/src/schema/`.
4. Escrever seeds globais (`0023_seed_global_templates.sql`).
5. Configurar `drizzle-kit` para gerar migrations.
