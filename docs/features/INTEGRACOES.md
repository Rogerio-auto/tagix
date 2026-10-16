# F75 — Loja de Integrações e framework de conectores

> **Status:** aprovado para construção (Rogério, 2026-10-16: maquete B1–B6 aprovada, "começar a construir").
> **Maquete:** [`../design/copilot-integracoes.html`](../design/copilot-integracoes.html) seções B1–B6 (`?solo=loja|detalhe|wizard|saude|vazio|webhook`),
> nota de UX [`../design/copilot-integracoes-ux.md`](../design/copilot-integracoes-ux.md) §5. Capturas em `../design/copilot-integracoes/`.
> **Decisão de arquitetura:** [ADR-005](../decisions/ADR-005-conectores-cofre-e-loja-de-integracoes.md).
> **Slots:** `tasks/slots/F75/` (S01–S16). Depende do schema do Copiloto (F73-S01) só pela ordem das migrações.

---

## 1. Objetivo

A empresa conecta o que já usa (ERP, pagamentos, loja, agenda, planilha, "qualquer sistema") **sem programar**,
vê em 2 segundos se cada conexão está funcionando, e o Leadium (e depois o Copiloto) passa a saber e fazer coisas
com esses dados. Nesta fase entregamos o **framework** (conectores, cofre, sincronização, mapeamento, webhook de
entrada, saúde) e **conectores de referência** (Conectar qualquer sistema por webhook/API, API REST genérica por
polling e importação de CSV/planilha com relatório). O padrão **SQL/MCP somente leitura** (o caminho do primeiro
cliente de ERP, a Maian, em TOTVS Protheus) fica especificado e testado contra um **fake**; o conector TOTVS não é
construído aqui.

## 2. Princípios (inegociáveis)

1. **Estado antes de nome.** O que está quebrado aparece primeiro, com a causa em português e o tamanho do problema.
2. **Nada é gravado até o passo 5** do assistente. Progresso do assistente é salvo por passo (rascunho), dado não.
3. **O dado externo é entrada não confiável.** Todo payload de ERP/webhook/planilha passa por Zod, limites de tamanho,
   e quando chega a um LLM vai delimitado como dado (padrão `app/guards/injection.py`), nunca como instrução.
4. **Somente leitura por padrão.** Escrita em sistema externo é a operação mais perigosa: exige a direção ativada
   pela pessoa no assistente com confirmação explícita (nível 4), e toda escrita pedida pelo Copiloto é **sempre
   nível 4** (prévia + "Revisei"). Conectores SQL/MCP **não têm** capacidade de escrita: não é um flag, é ausência
   de código.
5. **Fonte e hora sempre visíveis; dado velho para, não esconde.** Cada entidade sincronizada carrega `source` e
   `synced_at`. Passado o `maxStaleness` da conexão, a UI mostra o aviso e o Copiloto se recusa a responder com
   aquele dado ("os dados do Vértice estão parados há 3 h").
6. **Casar por código, nunca por nome.** Identidade externa é `external_id` **texto** (preserva zero à esquerda),
   escopado por `external_scope` (filial/empresa/loja). Nome nunca é chave de casamento.
7. **Toda resposta é paginada e tem teto.** Página que volta exatamente no teto é tratada como truncada
   (pagina de novo ou falha com `truncated_response`), nunca como "acabou".
8. **Erro dentro de 200 é erro.** Todo conector declara `detectError(body)`; resposta 200 com `{ "erro": … }`,
   `success:false`, `status:"error"` ou equivalente vira falha classificada.
9. **Segredo nunca volta.** Credenciais entram no cofre e só o runtime de conector (workers) decifra. A API devolve
   no máximo os 4 últimos caracteres. Nem a equipe Leadium lê pela UI de plataforma.
10. **Isolamento total entre empresas.** RLS em toda tabela com `workspace_id`, AAD da cifra amarrada a
    `workspace_id` + `connection_id`, cache e filas com chave por workspace.

## 3. Lições do projeto Maian (requisitos do conector)

| # | Lição | Requisito | Onde é garantido |
|---|---|---|---|
| L1 | O MCP do ERP corta em 500 linhas sem avisar | `PageRequest.limit` obrigatório; `limits.maxRowsPerResponse` declarado no manifesto; página cheia ⇒ "pode haver mais" | S02 (`paginate()` + teste de conformidade) |
| L2 | ERP devolve erro dentro de HTTP 200 | `detectError(body)` obrigatório no contrato; sem ele o conector não registra | S02 (registro do conector) |
| L3 | Código de cliente com zero à esquerda (`000123`) | `external_id` é `text`; Zod do conector rejeita `number` em campos-chave; teste com `"000123"` ≠ `"123"` | S01 (coluna) + S02 (schema de chave) |
| L4 | Um cliente com vários códigos/filiais | `external_scope` (filial/empresa) na chave única; um contato pode ter N refs | S01 (`external_refs`) |
| L5 | Casar por código, nunca por nome | `upsertByExternalRef` é o único caminho de escrita do motor; casamento por nome não existe na API | S04 |
| L6 | Acesso só leitura por SQL/MCP com polling | modos `sql_readonly` e `mcp_polling` só com `pull`; conformidade com fake | S02 |
| L7 | Mostrar fonte e hora; dado velho → parar | `synced_at` por ref + `maxStaleness` por conexão; estado `stale` | S04, S08, S11 |
| L8 | Escrita no ERP é o mais perigoso | direção "Leadium → externo" desligada por padrão, nível 4 ao ligar; Copiloto sempre nível 4 | S07, S10, §11 |

## 4. Arquitetura

```
                ┌─────────────────────────── apps/web ────────────────────────────┐
                │ /integracoes (Loja B1, vazio B5)  /integracoes/[slug] (detalhe B2│
                │ ou saúde B4)  /integracoes/[slug]/conectar (assistente B3)       │
                │ /integracoes/qualquer-sistema (B6)                               │
                └───────────────┬──────────────────────────────────────────────────┘
                                │ REST (Zod em @hm/shared/integrations)
                ┌───────────────▼──────────── apps/api ───────────────────────────┐
                │ routes/integrations/*  catálogo · conexões · assistente ·         │
                │   mapeamento · teste · saúde · pedidos · OAuth callback           │
                │ routes/integrations-inbound  POST /in/:endpointKey  (público)     │
                └──────┬──────────────────────┬───────────────────────────┬────────┘
                       │ outbox (mesma tx)     │ agents-client             │ @hm/db (RLS)
          ┌────────────▼──────────┐   ┌───────▼─────────────┐   ┌─────────▼──────────────┐
          │ apps/workers/          │   │ agent-runtime        │   │ Postgres               │
          │  integrations/         │   │ /internal/mapping/   │   │ integration_* tables   │
          │  scheduler → sync →    │   │   propose (S14)      │   │ external_refs          │
          │  upsert por ref →      │   └──────────────────────┘   │ RLS por workspace      │
          │  erros/execuções →     │                              └────────────────────────┘
          │  eventos de domínio    │
          └────────────┬───────────┘
                       │ usa
          ┌────────────▼──────────────────── packages/integrations (novo) ──────────────┐
          │ core: ConnectorManifest (Zod) · Connector runtime interface · registry      │
          │ http: ssrfSafeFetch + rate limit + timeouts + teto de bytes + detectError    │
          │ paging: paginate() com detecção de truncamento                               │
          │ vault: decrypt só aqui (server-only), AAD por conexão                        │
          │ mapping: motor de mapeamento (JSONPath restrito + transforms puros)          │
          │ connectors/: generic-webhook · generic-rest · csv-import                     │
          │ testing/: kit de conformidade + fakes (fake-sql-readonly, fake-mcp, fake-rest)│
          └──────────────────────────────────────────────────────────────────────────────┘
```

**Por que um pacote novo e não `packages/channels`:** canal é conversa com contato (mensagem, janela, template).
Integração é dado de negócio (cliente, pedido, produto, estoque) com cursor e reconciliação. Misturar os dois faria
o `provider` de canal (enum fechado com CHECK em `schema/channels.ts`) virar um saco de gatos. Ver ADR-005 §2.

### 4.1 Conector: contrato (S02)

```ts
// packages/integrations/src/core/manifest.ts (Zod é a fonte; o tipo é inferido)
ConnectorManifest = {
  id: string                       // 'generic-webhook' | 'generic-rest' | 'csv-import' | 'nimbo-gestao' ...
  version: string                  // semver; a conexão grava a versão que instalou
  name: string; vendor: string; category: 'erp'|'fin'|'ecom'|'mkt'|'cal'|'auto'|'dados'|'any'
  summary: string                  // 1 linha, PT-BR (card da loja)
  keywords: string[]               // busca por intenção: 'estoque', 'boleto', 'nota fiscal'
  maintainedBy: 'leadium'
  availability: 'available'|'soon' // 'soon' mostra "Avise-me"
  requiredFeature: string          // chave em plan.features/overrides (ex.: 'integrations', 'integrations_custom')
  authModes: AuthMode[]            // 'oauth2'|'api_key'|'webhook_inbound'|'sql_readonly'|'mcp_polling'|'file_upload'|'none'
  entities: Array<{
    entity: 'contact'|'deal'|'product'|'order'|'stock'|'appointment'
    directions: Array<'pull'|'push'>   // 'push' = escrever no externo; ausente nos modos SQL/MCP
    defaultDirection: 'pull'|'push'|'both'
    fields: FieldSpec[]            // campos externos conhecidos (path, tipo, exemplo, isKey)
    keyField: string               // caminho do código externo (sempre string)
    scopeField?: string            // filial/empresa (L4)
  }>
  permissions: Array<{ label: string; kind: 'read'|'write'|'excluded' }>  // texto PT-BR da B2
  copilot: { examples: string[]; tools: CopilotToolSpec[] }  // §11; só declarativo nesta fase
  limits: { maxRowsPerResponse: number; maxBytesPerResponse: number; requestsPerMinute: number;
            timeoutMs: number; maxPagesPerRun: number }
  schedule: { defaultIntervalSec: number; minIntervalSec: number; supportsWebhook: boolean }
  freshness: { maxStalenessSec: number }   // L7
  history: { initialWindowDays: number }   // "Últimos 24 meses"
}

interface Connector {
  manifest: ConnectorManifest
  auth: { begin?(ctx): Promise<AuthBegin>; complete?(ctx, input): Promise<CredentialMaterial>;
          refresh?(ctx, cred): Promise<CredentialMaterial>; test(ctx): Promise<AuthTestResult> }
  detectError(status: number, body: unknown): ConnectorError | null          // L2, obrigatório
  pull?(ctx, req: { entity; cursor: string|null; page: PageRequest; window?: TimeWindow }): Promise<PullPage>
  push?(ctx, req: { entity; records: CanonicalRecord[] }): Promise<PushResult>  // só se 'push' declarado
  webhook?: { verify(ctx, req: RawInbound): VerifyResult; normalize(ctx, body: unknown): NormalizedEvent[] }
  sample(ctx, req: { entity; n: number }): Promise<ExternalRecord[]>          // passo 4 (5 registros reais)
}

PullPage = { records: ExternalRecord[]; nextCursor: string|null; truncatedSuspected: boolean; fetchedAt: string }
ExternalRecord = { externalId: string; externalScope: string|null; updatedAt: string|null; raw: unknown }
```

`ctx` (`ConnectorContext`) é a única porta para o mundo: `fetch` guardado (SSRF + timeout + teto de bytes +
rate limit por conexão), `credentials()` (decifra sob demanda, nunca em log), `logger` com redação, `now()`,
`signal` de cancelamento. Conector não importa `node:http`, `pg` nem `@hm/db` (regra de lint do pacote).

**Modos de acesso:**

| Modo | Como entra | Direções | Uso nesta fase |
|---|---|---|---|
| `oauth2` | Authorization Code + PKCE, `state` assinado e de uso único | pull/push | framework + teste com provedor fake |
| `api_key` | chave colada, cifrada no cofre | pull/push | `generic-rest` |
| `webhook_inbound` | endpoint por conexão `/in/:endpointKey`, segredo próprio | pull (eventos) | `generic-webhook` (B6) |
| `sql_readonly` | DSN cifrado; o conector executa **só consultas declaradas no código** (parametrizadas), usuário de banco só leitura exigido no checklist | pull | fake + conformidade (Maian depois) |
| `mcp_polling` | URL + token MCP; chama ferramentas de leitura declaradas; polling | pull | fake + conformidade |
| `file_upload` | CSV/XLSX enviado pela pessoa (storage), processado uma vez | pull (uma vez) | `csv-import` |

### 4.2 Motor de sincronização (S04)

- **Scheduler** (in-process nos workers, como o resto) publica `integration.sync.requested` por
  `(connection, entity)` vencida (`next_run_at <= now()`), com lock de conexão (advisory lock por hash
  `connection_id`) para nunca rodar duas execuções da mesma entidade.
- **Execução** (`integration_sync_runs`): `kind ∈ {initial, incremental, reconcile, dry_run, reprocess}`.
  Lê páginas pelo `pull` até `nextCursor = null`, `maxPagesPerRun` ou orçamento de tempo (60 s), persistindo o
  cursor **depois de cada página aplicada** (retomável). Página com `truncatedSuspected` sem cursor ⇒ falha
  `truncated_response` (não avança o cursor).
- **Aplicação por registro:** mapping → validação canônica (Zod) → `upsertByExternalRef(tx, …)`:
  1. busca `external_refs (workspace, connection, entity_type, external_scope, external_id)`;
  2. existe ⇒ atualiza a entidade se `hash(payload mapeado) ≠ ref.content_hash` (idempotente);
  3. não existe ⇒ tenta **casar por chave forte** declarada no mapeamento (CPF/CNPJ normalizado, e-mail
     normalizado, telefone E.164) — nunca nome — e senão cria; grava a ref;
  4. emite evento de domínio pela outbox na mesma transação (`contact.created`/`deal.won` etc. já existentes).
- **Conflito (bidirecional):** "vence a última alteração e fica registrada" (B3 passo 2). Comparação por
  `external updatedAt` vs `entity.updated_at` com relógio do servidor; o perdedor vai para
  `integration_sync_errors` com `code='conflict_overwritten'` (informativo, sem ação obrigatória).
- **Erros por registro** não derrubam a página: viram linhas agrupadas por `code` em `integration_sync_errors`
  (`11 pedidos sem cliente correspondente`), com `cause_pt`, amostra de até 10 `external_id`s e `occurrences`.
- **Retries:** erro transitório de rede/429/5xx ⇒ backoff exponencial com jitter (1 m, 5 m, 30 m, 2 h), depois
  `status='error'` e alerta (S08). 401/403 ⇒ tenta `refresh`; falhou ⇒ `needs_reauth` (card "Atenção · a chave
  expirou").
- **Reconciliação** diária (madrugada no fuso do workspace): varre IDs externos da janela e marca refs
  ausentes (`missing_since`), sem apagar entidade do Leadium.
- **Dry-run / amostra** (`kind='dry_run'`, passo 4 do assistente): roda `sample(n=5)` + mapping + validação +
  casamento **sem gravar**, devolve as 5 linhas com status `pronto|revisar` e o **padrão de erro com estimativa
  na carga completa** ("≈ 3% dos clientes", via `count` do conector quando existir, senão extrapolação declarada
  como estimativa). Correções oferecidas são transforms do mapeamento (ex.: `default_ddd: '11'`).
- **Pausar** para o scheduler; **Desconectar** revoga credencial (quando o provedor suportar), apaga o segredo do
  cofre, desativa endpoint inbound, pausa automações que usam a conexão e **mantém** o que já foi importado
  (B4 modal).

### 4.3 Mapeamento de campos (S05 + S14)

- Mapeamento é dado versionado (`integration_field_mappings`), validado por Zod em `@hm/shared/integrations`.
- Linguagem: caminho estilo JSONPath **restrito** (`a.b`, `a[]`, `a[0].b`; sem filtros nem expressões) + lista
  fechada de transforms puros (`trim`, `lower`, `digits_only`, `phone_e164{default_ddd}`, `cpf_cnpj`, `money`,
  `date{format,tz}`, `enum_map{…}` (ex.: `Faturado→Ganho`), `default{value}`, `concat{sep}`). Sem `eval`.
- Destinos canônicos fechados (lista em `@hm/shared/integrations/targets.ts`): `contact.name`, `contact.phone`,
  `contact.email`, `contact.document`, `deal.external_code`, `deal.value`, `deal.stage`, `deal.product`,
  `deal.owner`, `product.sku`, `product.name`, `product.price`, `stock.sku`, `stock.qty`, `ignore`, …
- **Proposta assistida:** o assistente envia um exemplo colado ou a amostra do passo 4. A API (S05) primeiro roda
  **heurística determinística** (detecção de tipo: CPF/CNPJ, telefone, e-mail, dinheiro, data; similaridade de
  nome de campo) e depois pede ao agent-runtime (S14) a proposta semântica. Ao modelo vão **só caminhos, tipos
  detectados e valores mascarados** (`"(11) 9****-**55"`, `"maria.s***@email.com"`), nunca o exemplo cru. A
  confiança final é `min(LLM, heurística)` quando divergem e o máximo quando concordam; **< 80% ⇒ "revisar"**.
  Obrigatório sem destino bloqueia o Continuar e diz qual falta. O exemplo não é persistido.

### 4.4 Webhook de entrada por empresa e "Conectar qualquer sistema" (S06)

- `POST https://<api>/in/:endpointKey` (a URL pública da maquete `hooks.leadium.com.br/in/arc_…` é o mesmo
  handler atrás do Nginx). `endpointKey` = `arc_` + 22 caracteres base62 aleatórios (≥ 128 bits), não sequencial.
- **Autenticação:** `Authorization: Bearer lk_live_<32 bytes base64url>`; guardamos só `sha256`. Rotação mantém
  o hash anterior válido por **24 h** (`secret_hash_prev`, `prev_valid_until`). Opcional e recomendado:
  assinatura HMAC no mesmo formato dos nossos webhooks de saída (`x-hm-signature-256` + `x-hm-timestamp`,
  tolerância 300 s, `verifyWebhookSignature` de `@hm/shared`), exigível por conexão.
- Limites: corpo ≤ 256 KB, `Content-Type: application/json`, 120 req/min por endpoint e 600/min por workspace
  (Redis), resposta uniforme `401` para chave inválida/endpoint inexistente/desativado (sem oráculo).
- **Idempotência:** `Idempotency-Key` (ou `sha256(corpo)` se ausente) único por endpoint por 7 dias.
- Aceita na hora (`202 { id }`), grava o evento cru em `integration_inbound_events` e enfileira pela outbox;
  o worker normaliza (`tipo` = `contato.upsert` | `negocio.criar` | `negocio.atualizar` | `pedido.upsert`), aplica
  o mapeamento (formato canônico da B6 dispensa mapeamento; formato próprio usa o mapeamento da conexão) e
  passa pelo mesmo `upsertByExternalRef`.
- **Teste ao vivo:** "Enviar evento de teste" chama a API, que injeta um evento `is_test=true`; o painel escuta via
  Socket.io na sala do workspace (`integration:event`) e mostra o que foi criado. Registros de teste ficam marcados
  e são **apagados em 24 h** (job de retenção).

### 4.5 Saúde e observabilidade (S08)

Por conexão: `status` (`active|syncing|paused|needs_reauth|error|stale|disconnected`), última sincronização com
sucesso, próxima, registros hoje (+% vs média de 7 dias), fila pendente e tempo estimado de escoamento, erros 24 h
(abertos, registros afetados), volume por hora (24 barras, hora com erro marcada), registro legível ("Pedido #48213
faturado virou negócio ganho…"). Ações: Reprocessar (erro ou todos), Sincronizar agora (cooldown 60 s), Pausar,
Retomar, Desconectar (modal com o que para e o que fica). Alertas viram **notificação** para quem tem
`integration.manage`, pelo caminho que já existe (`notifyEvent` em `apps/api/src/services/notifications`, cascata
push → WhatsApp → e-mail, log em `notification_deliveries`; não há tabela de notificação in-app) com três eventos
novos em `NOTIFICATION_EVENTS` (`integracao_falhou`, `integracao_reautenticar`, `integracao_parada`), `eventKey`
`<connectionId>:<causa>:<dia>` para dedup de 1 por conexão por causa por dia, e entram no Briefing do Copiloto
(ponte §11). O worker não chama a API: publica `integration.alert` pela outbox e um consumidor no processo da API
(ou o helper de notificação exportado para workers, se existir na data) entrega.

## 5. Modelo de dados (S01)

Todas com `workspace_id uuid not null` + **RLS** no padrão do repo + teste em `rls.test.ts`, FKs compostas por
workspace (padrão F70-S12), `created_at/updated_at timestamptz`. Migração = **próxima livre** depois das do
F73-S01 (hoje a última é `0096`; conferir `drizzle/meta/_journal.json`).

| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `integration_connections` | `id`, `connector_id text`, `connector_version text`, `display_name`, `status` (CHECK: `draft, active, paused, needs_reauth, error, disconnected`), `auth_mode` (CHECK), `config jsonb` (não secreto, Zod), `entity_settings jsonb` (entidades ligadas + direção + opções como "pedido faturado vira negócio ganho"), `wizard_state jsonb` (passo atual + rascunho), `max_staleness_sec int`, `connected_by uuid → members`, `connected_at`, `paused_at`, `disconnected_at`, `last_success_at`, `next_run_at` | `(workspace_id, status)`; único parcial `(workspace_id, connector_id) where status <> 'disconnected' and connector_id not in ('generic-webhook','generic-rest','csv-import')` (conectores de catálogo: uma por empresa; genéricos: várias) |
| `integration_credentials` | `id`, `connection_id`, `kind` (CHECK: `oauth_tokens, api_key, sql_dsn, mcp_token`), `ciphertext text` (formato v2 do cofre, §ADR-005), `key_version smallint`, `fingerprint text` (últimos 4), `expires_at`, `rotated_at` | único `(connection_id, kind)`; decifrar só por `@hm/integrations/vault` (lint restringe quem importa; ADR-005 §3) |
| `integration_oauth_states` | `state_hash`, `connection_id`, `pkce_verifier_ciphertext`, `redirect_after`, `expires_at` (10 min), `used_at` | único `state_hash`; limpeza por job |
| `integration_sync_states` | `connection_id`, `entity`, `cursor text`, `cursor_kind`, `high_watermark timestamptz`, `last_success_at`, `last_attempt_at`, `next_run_at`, `consecutive_failures int`, `backoff_until` | PK `(connection_id, entity)` |
| `integration_sync_runs` | `id`, `connection_id`, `entity`, `kind` (CHECK), `status` (`running, succeeded, partial, failed, cancelled`), `started_at`, `finished_at`, `counts jsonb {read,created,updated,unchanged,skipped,failed}`, `error_code`, `triggered_by` (`schedule|member|webhook|system`), `member_id` | `(connection_id, started_at desc)`; retenção 90 dias |
| `integration_sync_errors` | `id`, `connection_id`, `entity`, `code text`, `cause_pt text`, `hint_pt text`, `sample_external_ids text[]` (≤ 10), `occurrences int`, `first_seen_at`, `last_seen_at`, `status` (`open, resolved, ignored`), `last_run_id` | único parcial `(connection_id, entity, code) where status='open'` (agrupa) |
| `external_refs` | `id`, `connection_id`, `entity_type` (CHECK: `contact, deal, product, order, appointment`), `entity_id uuid`, `external_id text` (**nunca numérico**), `external_scope text not null default ''` (filial/empresa), `content_hash text`, `source_updated_at`, `synced_at`, `missing_since`, `is_test bool` | **único** `(workspace_id, connection_id, entity_type, external_scope, external_id)`; `(workspace_id, entity_type, entity_id)`; triggers `AFTER DELETE` em `contacts`, `deals`, `products` removem refs órfãs |
| `integration_field_mappings` | `id`, `connection_id`, `entity`, `version int`, `mapping jsonb` (Zod), `created_by`, `is_active bool` | único parcial `(connection_id, entity) where is_active` |
| `integration_inbound_endpoints` | `id`, `connection_id`, `endpoint_key text`, `secret_hash text`, `secret_hash_prev text`, `prev_valid_until`, `require_signature bool`, `signing_secret_ciphertext text null`, `status` (`active, disabled`), `last_event_at` | único global `endpoint_key` (lookup privilegiado fora de RLS, como o aceite de convite) |
| `integration_inbound_events` | `id`, `endpoint_id`, `connection_id`, `idempotency_key text`, `received_at`, `payload jsonb` (≤ 256 KB), `is_test bool`, `status` (`received, processed, failed, ignored`), `result jsonb` (o que criou), `error_code` | único `(endpoint_id, idempotency_key)`; retenção 30 dias (teste: 24 h) |
| `integration_requests` | `id`, `member_id`, `system_name text`, `normalized_name text`, `purposes text[]`, `urgency` (CHECK: `would_help, manual_today, blocking`), `search_query text` | `(normalized_name)`; contagem entre empresas só por função `SECURITY DEFINER` que devolve **apenas o número** |
| `integration_interest` | `connector_id`, `member_id`, `created_at` ("Avise-me" de Em breve) | único `(workspace_id, connector_id, member_id)` |

Contatos/deals/produtos **não ganham coluna nova**; `source` livre continua como está. A fonte e a hora exibidas
vêm de `external_refs` (join pelo índice `(workspace_id, entity_type, entity_id)`). Ver ADR-005 §4.

## 6. Contratos HTTP (S07, S05, S06, S08, S03)

Prefixo `/api/integrations`, sessão + empresa ativa, permissões de §7, Zod estrito em toda entrada (schemas em
`packages/shared/src/integrations/`). Erros `{ error: <code> }`.

| Método e rota | Permissão | Entrada → Saída |
|---|---|---|
| `GET /catalog?q=&category=` | `integration.view` | → `{ items: CatalogItem[], mine: ConnectionSummary[] }`. `CatalogItem = { id, name, vendor, category, summary, availability, state: 'connect'|'connected'|'attention'|'soon'|'locked', note?, planLabel, monogram }`. Busca por intenção usa `keywords` + entidades + `summary` (normalizado sem acento) |
| `GET /catalog/:connectorId` | `integration.view` | → detalhe B2: entidades/direções, exemplos do Copiloto, permissões em PT-BR, preço/plano, requer, frequência, histórico inicial |
| `POST /connections { connectorId }` | `integration.manage` | cria `draft` (ou devolve o draft existente) → `{ connection }`; `402 plan_required` se a feature do plano faltar |
| `GET /connections/:id` | `integration.view` | → `ConnectionDetail` (sem segredo; `credential: { kind, fingerprint, expiresAt } | null`) |
| `PATCH /connections/:id/wizard { step, patch }` | `integration.manage` | salva rascunho por passo; valida o passo; → `{ wizardState, blockers: string[] }` |
| `POST /connections/:id/credentials { kind, value }` | `integration.manage` | cifra e grava; roda `auth.test`; → `{ ok, fingerprint }` (nunca ecoa o valor) |
| `GET /connections/:id/oauth/start` | `integration.manage` | → `{ authorizeUrl }` (state + PKCE) |
| `GET /api/integrations/oauth/callback?state&code` | sessão | conclui, redireciona para o passo 2 do assistente |
| `POST /connections/:id/mapping/propose { entity, sample? }` | `integration.manage` | → `{ fields: [{ source, example, target, confidence, required, needsReview, transforms }] }` (S05; exemplo não salvo) |
| `PUT /connections/:id/mapping/:entity { mapping }` | `integration.manage` | nova versão ativa |
| `POST /connections/:id/test { entity }` | `integration.manage` | dry-run com 5 registros reais → `{ rows: [{ externalId, preview, status: 'ready'|'review', issues }], patterns: [{ code, message, estimatePct, estimateCount, fixes: Fix[] }] }` |
| `POST /connections/:id/activate` | `integration.manage` | passo 5: valida tudo, ativa, agenda `initial` → `{ runIds }`. Ligar direção `push` exige `{ confirmWrite: true }` (nível 4) |
| `GET /connections/:id/health` | `integration.view` | → KPIs, `hourly[24]`, `errors[]`, `nextRunAt`, `queue` (S08) |
| `GET /connections/:id/log?filter=all|errors|deals&cursor` | `integration.view` | registro legível paginado (S08) |
| `POST /connections/:id/errors/:errorId/reprocess` · `POST /connections/:id/reprocess-all` | `integration.operate` | → `{ runId }` |
| `POST /connections/:id/sync-now` · `/pause` · `/resume` | `integration.operate` | cooldown 60 s no sync-now (`429 sync_cooldown`) |
| `POST /connections/:id/disconnect { acknowledged: true }` | `integration.manage` | → `{ pausedAutomations: n, keptRecords: n }` |
| `POST /connections/:id/inbound/rotate-secret` | `integration.manage` | → `{ secret }` **uma única vez** + `Cache-Control: no-store` |
| `POST /connections/:id/inbound/test-event` | `integration.manage` | injeta evento de teste → `{ eventId }` |
| `POST /requests { systemName, purposes, urgency, searchQuery? }` | `integration.request` | → `{ request, sameRequestCount }` |
| `POST /catalog/:connectorId/interest` | `integration.request` | "Avise-me" idempotente |
| `POST /in/:endpointKey` (router público) | chave da conexão | → `202 { id }` · `401` uniforme · `413` · `415` · `429` |

## 7. Permissões e plano

Novas chaves em `ROLE_CAN` (`packages/shared/src/permissions.ts`):

| Chave | Papéis | Por quê |
|---|---|---|
| `integration.view` | `ALL` | ver loja e saúde é informação; não expõe segredo |
| `integration.request` | `STAFF` | qualquer pessoa da operação pode pedir |
| `integration.operate` | `MANAGERS` | reprocessar, sincronizar agora, pausar/retomar: operação reversível |
| `integration.manage` | `ADMINS` | conectar, credenciais, mapeamento, direção de escrita, desconectar, rotacionar segredo |

Plano: `plan.features.integrations` (loja + conectores de catálogo), `plan.features.integrations_custom`
(qualquer sistema / REST genérico), `plan.limits.max_integrations` (conexões não desconectadas). Resolvido por
`resolveEntitlements` (`apps/api/src/services/platform/entitlements.ts`). **Hoje nenhuma feature de plano é
aplicada no produto** (só `max_members`): o S07 cria o primeiro gate genérico `requireFeature(key)` em
`apps/api/src/services/integrations/entitlements.ts`, com a regra "feature ausente no plano = desligada; plano sem
`features` definido (legado) = ligada" para não quebrar empresas existentes. Auditoria: não há helper genérico
(só `recordWorkspaceAudit` de convite); o S07 cria `recordIntegrationAudit(tx, req, entry)` com
`resource_type='integration_connection'` e todo slot de API da F75 o usa em conectar, credencial, mapeamento,
direção de escrita, pausar, reprocessar, desconectar e rotação de segredo. Sem a feature, o card mostra `locked` com o plano que inclui ("Incluída no Pro").
Assinatura somente leitura (F71-S06): leitura segue, nenhuma escrita/ativação (`402 read_only`).

## 8. Ameaças (para S13)

| # | Ameaça | Controle |
|---|---|---|
| T1 | SSRF por URL de API/MCP fornecida pelo cliente (metadados de nuvem, rede interna, DNS rebinding) | `ssrfSafeFetch` + `createGuardedLookup` em toda chamada do `ctx.fetch`; redirect revalidado; só `https` em produção; porta 443/8443 por padrão |
| T2 | Exfiltração entre empresas (ref, endpoint, credencial de outra empresa) | RLS + FK composta por workspace + AAD da cifra com `workspace_id:connection_id:kind`; lookup de endpoint devolve o `workspace_id` e todo o resto roda em `withWorkspace` |
| T3 | Vazamento de segredo (log, API, erro, Sentry, plataforma) | vault só por lista fechada de importadores (lint); redator do logger com chaves `ciphertext`, `secret`, `token`, `authorization`, `dsn`; resposta só `fingerprint`; teste "grep no log" |
| T4 | Injeção via dado do ERP no LLM (nome de produto com instrução) | valores mascarados para a proposta; spotlighting `⟦…⟧`; saída validada contra lista fechada de destinos; Copiloto trata dado de integração como dado (§11) |
| T5 | Injeção via dado do ERP no app (XSS, CSV injection no export, SQL) | render sempre como texto; prefixo `'` em células iniciadas por `= + - @` em export; SQL só parametrizado e declarado |
| T6 | Webhook inbound: força bruta de chave, replay, flood, payload gigante | chave ≥ 128 bits + 401 uniforme + rate limit; idempotência; HMAC com timestamp opcional; 256 KB; profundidade JSON ≤ 32 |
| T7 | OAuth: CSRF/mix-up/code injection | `state` assinado de uso único (10 min) ligado ao membro e à conexão; PKCE S256; redirect URI fixa |
| T8 | Escrita indevida no ERP | direção `push` desligada por padrão + confirmação nível 4 + auditoria; SQL/MCP sem capacidade de escrita |
| T9 | Planilha maliciosa (zip bomb XLSX, CSV gigante, encoding) | limite 10 MB / 50 mil linhas / 100 colunas; parser em streaming; XLSX com limite de descompressão |
| T10 | Contagem entre empresas em "pedidos" vira oráculo | função `SECURITY DEFINER` devolve só número, com nome normalizado; sem lista, sem nomes de empresas |
| T11 | Chave de cifra única, sem rotação real | keyring por versão + AAD + job de recifra (ADR-005 §3) |

## 9. Métricas

- Tempo até a primeira sincronização com sucesso (meta: mediana ≤ 10 min do clique em Conectar).
- Taxa de conclusão do assistente por passo (abandono por passo).
- % de campos aceitos sem edição na proposta de mapeamento (meta ≥ 80%).
- Sync com sucesso / total por conexão (meta ≥ 99% em 7 dias), atraso p95 de incremental ≤ 2× intervalo.
- Erros abertos > 24 h por conexão; tempo até reprocessar.
- Pedidos de integração por sistema normalizado (prioriza o roadmap de conectores).

## 10. Fora de escopo (F75)

- Conector TOTVS Protheus/Maian, Omie, Bling, ContaAzul ou qualquer ERP de marca (vêm depois, um slot por conector,
  sobre este framework; o primeiro real é a Maian em `sql_readonly`/`mcp_polling`).
- Marketplace aberto a terceiros (desenvolvedores externos publicando conectores, revenue share). Ver ADR-005 §1.
- Ferramentas do Copiloto sobre integrações (só especificadas em §11; construídas na F74 ou depois).
- Webhooks de saída (já existem; a loja só os **lista** como card "Webhooks de saída" apontando para a tela atual).
- Integração de agenda externa (Google/Outlook) — continua no plano de `AGENDA_SYNC.md`.

## 11. Ponte com o Copiloto (especificado, não construído)

Quando uma conexão fica `active`, o Copiloto (F73/F74) passa a ter, **por manifesto** (`copilot.tools`):

- **Leitura** (nível 1): `integration.query(entity, filtros)` sobre os dados já sincronizados no Leadium (nunca
  chamada ao vivo no ERP por pergunta), devolvendo **fonte e hora** (`external_refs.synced_at`). Se a conexão
  está `stale`/`error`, a ferramenta devolve `stale_data` e o Copiloto diz que o dado está parado (L7).
- **Regras** (nível 3): "avise quando pedido > R$ 10 mil for faturado" vira automação proposta; a pessoa aprova.
- **Escrita no externo** (nível 4 sempre): só se a conexão tem `push` ativo e o papel tem `integration.manage`;
  prévia + "Revisei".
- **Briefing:** alertas de S08 entram como item ("Pagora com a chave expirada há 2 dias").
- **Exemplos da B2** ("Quais pacientes compraram alinhadores…") são `copilot.examples` no manifesto, mostrados
  no detalhe e oferecidos como sugestão no Copiloto após conectar.
- Contrato para a F74: `listActiveIntegrationTools(workspaceId) → CopilotToolSpec[]` exportado por
  `@hm/integrations` (S02 define o tipo; a implementação de execução é da F74).

## 12. Mapa maquete → slot

| Maquete | Tela | Backend | Frontend |
|---|---|---|---|
| B1 Loja (catálogo, busca por intenção, categorias, Suas integrações, Avise-me) | `/integracoes` | S07 | S09 |
| B2 Detalhe (sincroniza, Copiloto ganha, permissões, preço) | `/integracoes/[slug]` (sem conexão) | S07 | S09 |
| B3 Assistente 5 passos (autorizar, o que sincronizar, mapear com Copiloto, testar 5, sincronizar) | `/integracoes/[slug]/conectar` | S03, S04, S05, S14, S07 | S10 |
| B4 Saúde (KPIs, erros com causa, reprocessar, pausar, desconectar, registro) | `/integracoes/[slug]` (com conexão) | S08 | S11 |
| B5 Vazio inteligente + Pedir integração | `/integracoes?busca=` | S07 | S09 |
| B6 Conectar qualquer sistema (endereço, chave, formato, teste ao vivo) | `/integracoes/qualquer-sistema` | S06 | S11 |
| Importação CSV/planilha com relatório | assistente com `file_upload` | S12 | S10 |

## 13. Ondas

- **Onda 1 (já pode começar):** S02 (framework, sem banco) ‖ S14 (proposta de mapeamento no agent-runtime) ‖
  S16 (SSRF no port HTTP do flow-engine: achado da verificação de código de 16/10, ver §14).
- **Onda 2 (após F73-S01):** S01 (schema).
- **Onda 3:** S07 (catálogo, conexões, permissões, plano e esqueleto de rotas).
- **Onda 4:** S03 (cofre + OAuth) ‖ S05 (mapeamento) ‖ S09 (Loja UI).
- **Onda 5:** S04 (motor de sync).
- **Onda 6:** S06 (webhook de entrada) ‖ S08 (saúde e alertas).
- **Onda 7:** S12 (conectores de referência) ‖ S11 (saúde UI + qualquer sistema UI).
- **Onda 8:** S10 (assistente UI; também depende do F76-S03) ‖ S13 (portão de segurança).
- **Onda 9:** S15 (QA e2e + `/hm-designer`).

Caminho crítico: F73-S01 → S01 → S07 → S03 → S04 → S06 → S12 → S10 → S15.

Barra de pronto de UI: a mesma de `DS3_ADOCAO.md` §5 (capturas 375/768/1440 nos dois temas, axe sem violação
séria pelo fixture `apps/web/e2e/fixtures/a11y.ts` (`expectNoSeriousAxe`), orçamento de peso, `/hm-designer`,
reduced-motion, sem hex literal).

## 14. O que a verificação de código (16/10/2026) achou

| Fato | Consequência na F75 |
|---|---|
| `getKey(_keyVersion)` em `packages/db/src/crypto.ts` ignora a versão; payload `iv:tag:ct` sem prefixo de versão nem AAD | S03 cria keyring e formato v2 autodescritivo, compatível com o legado (ADR-005 §3) |
| O runbook `rotate-encryption-key.md` não lista `meta_connections.access_token_enc` nem `workspace_custom_values` (kind `secret`) | S03 corrige o runbook e o job de recifra cobre todas as colunas |
| `packages/flow-engine/src/ports/http.port.ts` (`flowHttpPort`, padrão dos workers) usa `fetch` sem SSRF guard, apesar do comentário do handler | **S16** (segurança, independente) |
| CHECK `channels_provider_columns` (migração 0002) não tem ramo para `email` | fora da F75; registrado para o Rogério (provável falha ao criar canal de e-mail) |
| Nenhuma feature de plano é aplicada no produto | S07 cria o primeiro gate (`requireFeature`) |
| Não há helper genérico de auditoria nem tabela de notificação in-app | S07 cria `recordIntegrationAudit`; S08 usa `notifyEvent` |
| `@axe-core/playwright` não está instalado; o repo injeta `axe-core` por fixture | slots de UI usam `expectNoSeriousAxe` |
| O OAuth da Meta não tem callback de redirect no servidor (troca de `code` do SDK JS) | S03 cria o primeiro callback OAuth genérico do servidor |
