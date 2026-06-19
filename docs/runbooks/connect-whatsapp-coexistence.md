# Runbook — Conectar WhatsApp oficial (Cloud API e Coexistência)

> **Quando:** ao plugar um número WABA real na Leadium — número novo (Cloud API) ou número que
> já está no app **WhatsApp Business** (coexistência).
> **Postura:** Highermind/Leadium como **Tech Provider** único — o mesmo Meta App de WhatsApp e
> Instagram, com um **webhook unificado** `https://api.leadium.com.br/webhooks/meta`.
> **Quem executa:** operador da plataforma (super-admin) + o cliente dono do número (faz o
> Embedded Signup e define o PIN).
> **Resultado esperado:** canal `meta_whatsapp` ativo no workspace, inbound aparecendo no inbox e
> — em coexistência — echo das mensagens enviadas pelo app e histórico importado.

Feature de referência (slots): F39-S01 (connect backend) · F39-S02 (wizard) · F39-S03 (ingestão de
coexistência) · F39-S04 (workers). E2e: `apps/web/e2e/specs/whatsapp-coexistence.spec.ts`.

---

## 0. Glossário rápido

| Termo | O que é |
|---|---|
| **WABA** | WhatsApp Business Account — agrupa números (`waba_id`). |
| **`phone_number_id`** | id do número na Cloud API (não é o telefone; é o id da Graph). |
| **Cloud API** | número 100% na API oficial da Meta (sem app WhatsApp Business no celular). |
| **Coexistência** | o mesmo número roda no **app WhatsApp Business** E na Cloud API ao mesmo tempo. |
| **Embedded Signup** | fluxo de FB Login que devolve um `code` + os ids (`phone_number_id`, `waba_id`). |
| **Echo** | cópia, via webhook, de uma mensagem que o operador enviou **pelo app** (coexistência). |

---

## 1. Pré-requisitos (já feitos na Onda 0 — só conferir)

No servidor de produção (`/opt/leadium/.env`):

```bash
# Conferir que estão preenchidos (NÃO imprimir os valores em canal compartilhado):
grep -E '^(META_APP_ID|META_APP_SECRET|META_WEBHOOK_VERIFY_TOKEN)=' /opt/leadium/.env | cut -d= -f1
```

- `META_APP_ID` — App ID do Meta App (Tech Provider Leadium).
- `META_APP_SECRET` — App Secret (usado na troca `code`→token **e** no HMAC do webhook).
- `META_WEBHOOK_VERIFY_TOKEN` — token de verificação do handshake GET do webhook.

Esses três viram `platformSecrets` na API:
`meta_app_id`, `meta_app_secret`, `meta_webhook_verify_token`. Sem `meta_app_id`/`meta_app_secret`
o connect responde **503 `WA_CONNECT_APP_NOT_CONFIGURED`** (não é erro do cliente — é config da
plataforma).

Confirme também que a API e os workers estão de pé:

```bash
# API responde o handshake do webhook (deve devolver 403 sem os params certos — é o esperado):
curl -s -o /dev/null -w '%{http_code}\n' https://api.leadium.com.br/webhooks/meta

# Worker de coexistência consumindo a fila (procurar a linha "coexistence worker iniciado"):
docker compose -f /opt/leadium/docker-compose.prod.yml logs --tail=50 workers | grep coexistence
```

---

## 2. Configuração na Meta (Meta App → WhatsApp → Configuração)

### 2.1 Webhook (Callback URL + verify token)

App Dashboard → **WhatsApp → Configuração** (ou **App Settings → Webhooks → WhatsApp Business
Account**):

- **Callback URL:** `https://api.leadium.com.br/webhooks/meta`
- **Verify token:** o **mesmo** valor de `META_WEBHOOK_VERIFY_TOKEN` no `.env`.
- Clicar **Verificar e salvar** — a Meta faz um `GET` com `hub.mode=subscribe`,
  `hub.verify_token=<token>`, `hub.challenge=<n>`. A API devolve o `challenge` em texto puro
  (`200`). Se o token não bater, devolve **403** (ver Troubleshooting §6).

### 2.2 Assinar os campos do webhook (subscription fields)

Na mesma tela, em **Webhook fields** da WABA, assinar:

| Campo | Necessário para | Modo |
|---|---|---|
| `messages` | inbound + status (entregue/lido) — base de qualquer atendimento | Cloud API **e** coexistência |
| `history` | importar o histórico de conversas do app WhatsApp Business | **coexistência** |
| `smb_message_echoes` | receber echo das mensagens enviadas **pelo app** | **coexistência** |
| `smb_app_state_sync` | estado do vínculo de coexistência (iniciando/sincronizando/ok) | **coexistência** |

> A assinatura por número (`subscribed_apps` na WABA) é feita **automaticamente pelo connect**
> (`POST /{waba_id}/subscribed_apps`), com os campos certos por modo
> (`whatsapp-connect.ts` → `WA_CLOUD_API_SUBSCRIBED_FIELDS` × `WA_COEXISTENCE_SUBSCRIBED_FIELDS`).
> A assinatura no nível do App (esta tela) é o complemento que garante a entrega no endpoint.

---

## 3. Conectar via wizard

`app.leadium.com.br` → **Configurações → Canais → Conectar canal → WhatsApp (Meta)**.

### 3.1 Escolher o modo

| Modo | Quando usar | Pré-condição do número |
|---|---|---|
| **Número novo (Cloud API)** | número que **não** está em nenhum app WhatsApp | número limpo; você define o PIN no Signup |
| **Coexistência** | número que o cliente **já usa** no app WhatsApp Business | número ativo no app; mantém o app funcionando |

### 3.2 Embedded Signup

- Com o SDK da Meta disponível: botão **Entrar com a Meta** (Cloud API) /
  **Conectar número existente** (coexistência) abre o Embedded Signup; ao concluir, o wizard captura
  `code` + `phone_number_id` + `waba_id` (e o telefone, em coexistência).
- Sem SDK no ambiente (hoje o SDK **não está instalado** — `fb-login.ts` é stub): cair na
  **entrada manual**, colando `code` + `Phone Number ID` + `WABA ID` do painel da Meta. É o **mesmo
  contrato** que o backend recebe — o connect funciona idêntico.

### 3.3 Finalizar

- **Nome do canal** (livre, ex.: "Atendimento Coex").
- **PIN do WhatsApp (6 dígitos)** — PIN de verificação em duas etapas do número. Se nunca foi
  definido, defina um agora na Meta. (⚠️ ver Risco R3 — coexistência pode não exigir PIN.)
- **Conectar WhatsApp** dispara `POST /api/channels/whatsapp/connect`
  `{ code, phoneNumberId, wabaId, pin, mode, name, phoneNumber? }`. O backend, em ordem:
  1. `exchangeCodeForToken` — troca o `code` por token long-lived;
  2. `registerPhoneNumber` — `POST /{phone_number_id}/register` com o PIN;
  3. `subscribeWabaApp` — `POST /{waba_id}/subscribed_apps` (campos por modo);
  4. cria o canal `meta_whatsapp` (`metadata.waConnectMode`) e **cifra o token** (nunca volta ao
     cliente).
- Falha em qualquer etapa aborta **antes** de criar o canal → toast com a mensagem da Meta
  (422 `WA_CONNECT_*`) ou 502 genérico. Nenhum token é persistido se algo falhar.

---

## 4. Checklist de validação

Marque cada item com o número real conectado:

- [ ] **Handshake verde** — webhook salvo na Meta sem erro (GET retornou o `challenge`).
- [ ] **Canal ativo** — aparece em Configurações → Canais com badge **Conectado**.
- [ ] **Inbound real** — enviar uma mensagem **de outro celular** para o número → mensagem aparece
      no inbox em segundos. (Confirma `messages` + dedup + publisher.)
- [ ] **(Coexistência) Echo** — enviar uma mensagem **pelo app WhatsApp Business** do número
      conectado → ela aparece como **outbound** na mesma conversa. (Confirma `smb_message_echoes` →
      `publishCoexistenceEcho` → worker `persistEcho`.)
- [ ] **(Coexistência) Histórico** — abrir a conversa de um contato que já existia no app → as
      mensagens antigas foram importadas (pode levar alguns minutos). (Confirma `history` →
      `publishHistoryBatch` → worker `importHistory`, idempotente.)
- [ ] **(Coexistência) App state** — conferir `channels.metadata.coexistence` no banco:

```sql
SELECT name, metadata->'coexistence' AS coexistence, metadata->>'waConnectMode' AS mode
FROM channels
WHERE provider = 'meta_whatsapp'
ORDER BY created_at DESC
LIMIT 5;
```

Observabilidade — após o tráfego, conferir as linhas estruturadas nos logs:

```bash
docker compose -f /opt/leadium/docker-compose.prod.yml logs --tail=200 api workers \
  | grep -E 'webhook.whatsapp.coexistence.published|coexistence: (echo|history|app_state)'
```

---

## 5. Riscos conhecidos a validar com número real (IMPORTANTE — compilado dos slots)

Estes pontos foram implementados sob **suposição de contrato** (a feature foi construída sem um
número WABA real para fechar o loop). Cada um pode exigir ajuste de código quando o Rogério conectar
um número de verdade. Validar nesta ordem:

- **R1 — Nomes exatos dos campos de coexistência e shape do `subscribed_apps` (Graph v23.0).**
  O código assume `messages` / `history` / `smb_message_echoes` / `smb_app_state_sync`
  (`whatsapp-connect.ts`) e envia `subscribed_fields` como **CSV** em `POST /{waba_id}/subscribed_apps`.
  Confirmar contra a doc Graph vigente: nomes idênticos, e se a Meta espera `subscribed_fields` CSV
  vs. array. Se a Meta recusar, ajustar as constantes / o shape do POST.

- **R2 — Troca `code` → token (`exchangeCodeForToken`).**
  Hoje: `GET /oauth/access_token?client_id&client_secret&code` (secret na query, sem Bearer).
  Possíveis exigências reais: `grant_type=authorization_code`, `redirect_uri`, ou um **segundo hop**
  para trocar o token de curta por long-lived (`fb_exchange_token`). Se a Graph não devolver
  `access_token`, o connect lança `WA_CONNECT_EXCHANGE_FAILED` — esse é o sintoma a observar.

- **R3 — `register` (PIN) pode não se aplicar em coexistência.**
  O schema do endpoint hoje **exige** `pin: /^\d{6}$/` em **ambos** os modos
  (`routes/channels/index.ts` → `waConnectSchema`), e o backend chama `registerPhoneNumber` sempre.
  Em coexistência o número já está registrado no app — a Meta pode **não exigir** (ou recusar) o
  `register`/PIN. Se confirmado: tornar `pin` opcional para `mode='coexistence'` e pular
  `registerPhoneNumber` nesse caminho. (Ajuste de produção → vira sub-slot; este runbook é só docs.)

- **R4 — `messages.type` fora do enum pode falhar o insert do histórico.**
  O parser de history (`coexistence.ts`) carrega `type` cru da Meta; o worker
  (`importHistory`) insere as mensagens. Se o schema `messages.type` no banco for um enum estrito e
  o histórico trouxer um tipo não previsto (ex.: `reaction`, `ephemeral`, `system`), o insert pode
  quebrar. Validar com um número que tenha histórico variado; se quebrar, mapear tipos
  desconhecidos para um fallback (`unsupported`) no worker.

- **R5 — Volume e ordering do import de histórico.**
  O `history` chega em batches; a importação é **idempotente** (ancorada em `wamid`/`wa_id`), mas o
  **ordering** das mensagens importadas e o **volume** (rate/lote) com um número de produção não
  foram exercitados. Conferir: timeline na ordem cronológica correta e ausência de pressão indevida
  na fila/DB com históricos grandes.

- **R6 — `phone_number_id` × `waba_id` capturados no Signup.**
  No modo manual o operador cola os ids; no Embedded Signup real eles chegam via `postMessage`
  (`WA_EMBEDDED_SIGNUP`) — os nomes de campo (`phone_number_id` / `waba_id` / `display_phone_number`)
  são **suposição** documentada em `fb-login.ts`. Confirmar os nomes reais ao integrar o SDK.

---

## 6. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Webhook **403** no "Verificar e salvar" | verify token na Meta ≠ `META_WEBHOOK_VERIFY_TOKEN` | alinhar os dois valores; reiniciar a API se o `.env` mudou |
| Webhook **403** nos POSTs (eventos não chegam) | HMAC inválido — `META_APP_SECRET` errado/desalinhado | conferir o secret; a assinatura usa o **raw body** (não re-serializar) |
| Connect **503 `WA_CONNECT_APP_NOT_CONFIGURED`** | `meta_app_id`/`meta_app_secret` ausentes na plataforma | preencher no `.env` e reiniciar a API |
| Connect **422 `WA_CONNECT_EXCHANGE_FAILED`** | troca do `code` falhou (R2) ou `code` expirado/reusado | gerar novo `code` no Signup; revisar R2 |
| Connect **422 `WA_CONNECT_REGISTER_FAILED`** | PIN incorreto, número já registrado em outro app, ou R3 | conferir PIN; em coexistência avaliar R3 |
| Connect **422 `WA_CONNECT_SUBSCRIBE_FAILED`** | `subscribed_apps` recusado (R1) | revisar nomes/shape dos campos (R1) |
| Número conecta mas **inbound não chega** | webhook não assinou `messages`, ou App não assinou a WABA | conferir §2.2; conferir `subscribed_apps` da WABA na Graph |
| **Echo não aparece** (coexistência) | `smb_message_echoes` não assinado, ou worker parado | conferir §2.2 + log "coexistence worker iniciado"; testar enviando pelo app |
| **Histórico não importa** | `history` não assinado, ou batch ainda em trânsito (assíncrono) | aguardar minutos; conferir `webhook.whatsapp.coexistence.published` e R4/R5 |

---

## 7. Após validar

- Se algum risco R1–R6 exigir mudança de produção: **não** corrigir neste runbook — abrir sub-slot
  (este slot, F39-S05, é validação + docs e não toca código de S01–S04).
- Registrar na retro qual contrato a Meta confirmou (campos, `register` em coexistência, shape do
  `subscribed_apps`) para fechar as suposições.
