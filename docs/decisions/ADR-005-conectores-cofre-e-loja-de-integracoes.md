# ADR-005 — Conectores, cofre de credenciais, referências externas e a Loja de Integrações

> **Status:** aceita · **Data:** 2026-10-16 · **Fase:** F75
> **Decisor:** Rogério (loja aprovada na maquete B1–B6); arquitetura delegada ("decide e documenta")
> **Contexto:** [`../features/INTEGRACOES.md`](../features/INTEGRACOES.md),
> [`../design/copilot-integracoes-ux.md`](../design/copilot-integracoes-ux.md) §5

---

## 1. A Loja é decisão nova (e não é "marketplace")

O `AGENCIA_PLAN.md` §10 diz que marketplace "entra como decisão nova e documentada, não por deriva". Esta é a
decisão. **O que entra:** um **catálogo curado** de conectores **mantidos pela Leadium** (código no monorepo,
revisado, testado, versionado), mais o caminho genérico "Conectar qualquer sistema". **O que não entra:** loja
aberta a desenvolvedores terceiros, publicação de apps, revenue share, código de terceiros rodando no nosso
processo. Motivo: integração é por onde o dado do cliente entra e sai; código que não escrevemos rodando com
credencial de cliente é risco que não se paga nesta fase. Se um dia abrir para terceiros, é outro ADR (sandbox,
revisão, assinatura de pacote).

## 2. Abstração: pacote `@hm/integrations`, separado de `@hm/channels`

- **Canal ≠ integração.** Canal é conversa (mensagem, janela de 24 h, template, entrega). Integração é dado de
  negócio com cursor, paginação, mapeamento e reconciliação. O `provider` de canal é um conjunto fechado com
  CHECK em `schema/channels.ts`; enfiar ERP ali quebraria o contrato do `IChannelAdapter` e o CHECK.
- **Conector = manifesto declarativo (Zod) + implementação** com `auth`, `detectError` (obrigatório), `pull`,
  `push` (opcional), `webhook` (opcional), `sample`. Capacidades são **declaradas**: a UI (B2), as permissões em
  PT-BR, o gating por plano e as ferramentas do Copiloto vêm do manifesto, não de `if` espalhado.
- **Toda E/S passa pelo `ConnectorContext`:** `fetch` com SSRF guard (`ssrfSafeFetch`/`createGuardedLookup` de
  `@hm/shared/net`), timeout, teto de bytes, rate limit por conexão, logger com redação e credencial decifrada
  sob demanda. Conector não importa `pg`, `@hm/db` nem `node:http` (regra de lint do pacote). O banco é do motor.
- **Modos de acesso:** `oauth2`, `api_key`, `webhook_inbound`, `sql_readonly`, `mcp_polling`, `file_upload`.
  `sql_readonly` e `mcp_polling` **não implementam `push`**: a ausência de capacidade de escrita é estrutural.
  SQL só roda consultas **declaradas no código do conector**, parametrizadas; nunca SQL vindo de usuário ou LLM.
- **Lições Maian como contrato** (testadas por um kit de conformidade que todo conector passa): paginação
  obrigatória com detecção de truncamento (página cheia = talvez haja mais), erro dentro de 200 é erro, chave
  externa sempre `string` (zero à esquerda), escopo de filial na chave, casamento por código.

**Alternativas rejeitadas:** iPaaS embutido (Nango, Merge, Paragon): resolve OAuth e alguns CRMs/ERPs
americanos, mas não cobre ERP brasileiro em SQL Server/MCP, cobra por conexão e põe credencial de cliente num
terceiro. Pode virar **um** conector no futuro, nunca a abstração. n8n embutido: ótimo para o Rogério montar
fluxos, mas é runtime separado, multi-tenant fraco e não fala com RLS; fica como integração **de saída**
(webhooks) e o card "Automação externa".

## 3. Cofre de credenciais

- Tabela própria `integration_credentials`, uma linha por `(connection, kind)`.
- **Formato v2 autodescritivo:** `v2:<keyVersion>:<iv b64>:<tag b64>:<ct b64>`, AES-256-GCM, **AAD =
  `workspace_id:connection_id:kind`**. Uma credencial copiada para outra linha/empresa não decifra.
- **Keyring real:** `ENCRYPTION_KEYS="1:<hex64>,2:<hex64>"` + `ENCRYPTION_KEY_CURRENT=2`. Sem `ENCRYPTION_KEYS`,
  `ENCRYPTION_KEY` vale como versão 1 (compatível com tudo que existe). `decryptSecret` legado (`iv:tag:ct`)
  continua funcionando com a versão 1. Isso corrige o `getKey(_keyVersion)` que hoje ignora a versão.
- **Quem decifra:** só `@hm/integrations/vault` (server-only), chamado pelo runtime de conector nos workers e,
  na API, **apenas** pelos serviços de teste de autenticação, amostra (passo 4) e OAuth refresh. Uma regra de
  lint (`no-restricted-imports`) proíbe importar o vault fora de uma lista fechada de arquivos. O teste de
  autenticação do passo 1 roda com o texto em claro **antes** de gravar (a API já o tem na requisição) e o
  descarta. Nenhuma rota devolve texto em claro: no máximo `fingerprint` (4 últimos). Hoje API e workers usam o
  mesmo papel de banco (`hm_app`), então GRANT por coluna **não** separaria os dois: a fronteira é o código
  (lint + revisão do S13), e a AAD impede reaproveitar o texto cifrado em outra linha ou empresa.
- **Rotação:** job `integrations:reencrypt` (workers) recifra em lotes as linhas com `key_version < current` em
  todas as colunas cifradas (incluindo `channel_secrets`, `meta_connections`, `outbound_webhooks`,
  `platform_secrets` e `workspace_custom_values` de tipo `secret`, que hoje ficam fora do runbook), com
  idempotência e relatório. A chave antiga só sai do env depois de `count(*) where key_version < current = 0`
  em todas as tabelas. O runbook `rotate-encryption-key.md` é reescrito no S03.
- Segredo do webhook de entrada **não** vai ao cofre: só precisamos verificar, então guardamos `sha256` (e o
  anterior por 24 h na rotação). O segredo HMAC opcional (que precisamos para recalcular) vai cifrado.

## 4. Referências externas: tabela polimórfica `external_refs`

Escolhida **`external_refs`** (uma tabela para todas as entidades) contra **colunas por entidade**
(`contacts.external_id`, `deals.external_id`…):

| Critério | `external_refs` | colunas por entidade |
|---|---|---|
| N sistemas para a mesma entidade (ERP + loja + planilha) | sim, N linhas | 1 coluna = 1 sistema |
| N códigos/filiais por cliente (lição Maian) | sim, `external_scope` | não |
| Hora e fonte por sistema (dado velho → parar) | `synced_at` por ref | uma só |
| Migração em tabelas quentes (`contacts`, `deals`) | nenhuma coluna nova | `ALTER` + índice em tabela grande |
| Integridade referencial | sem FK polimórfica → triggers `AFTER DELETE` em `contacts`/`deals`/`products` e teste | FK natural |
| Consulta "contato pelo código do ERP" | 1 lookup no índice único | 1 lookup |

Chave única `(workspace_id, connection_id, entity_type, external_scope, external_id)`, `external_id text`
sempre. O custo (triggers e um join para mostrar a fonte) é menor que o ganho; e o `source` livre que já existe em
`contacts`/`deals` continua como está.

## 5. Escrita em sistema externo

Escrita é a operação mais perigosa (lição Maian). Direção `push` vem **desligada**; ligar no assistente exige
confirmação nível 4 ("Revisei", lista do que será escrito) e fica auditado. Toda escrita pedida pelo Copiloto é
nível 4, sempre, independentemente do volume. Conectores `sql_readonly`/`mcp_polling` não escrevem.

## 6. Webhook de entrada por empresa

Endpoint por conexão com chave pública aleatória (≥ 128 bits) e segredo próprio (Bearer, hash). Lookup do
endpoint é o único acesso fora de RLS (como o aceite de convite); a partir dele tudo roda em `withWorkspace`.
Resposta `401` uniforme para chave errada, endpoint inexistente ou desativado. Processamento assíncrono pela
outbox (padrão F70-S16), idempotente por `Idempotency-Key`.

## 7. Consequências

- 12 tabelas novas com RLS (S01), um pacote novo (`packages/integrations`), um diretório de worker
  (`apps/workers/src/integrations`), rotas `/api/integrations/*` e `/in/:endpointKey`.
- O primeiro gate de plano aplicado no produto (`requireFeature`).
- Cada conector de marca futuro (TOTVS/Maian, Omie, Bling…) é **um slot** sobre este framework, passando no kit
  de conformidade.
- O Copiloto ganha ferramentas por manifesto (ponte especificada em `INTEGRACOES.md` §11).
