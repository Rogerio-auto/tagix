# Backlog — papéis de login separados no Postgres (MEDIUM-3b)

> Origem: segunda auditoria de segurança pré-deploy (25/09/2026), MEDIUM-3(b). Registrado na
> F70-S24. **Não implementado.** Este documento é o plano. A execução vira slot própria.

## Situação hoje

- `api`, `workers` e `agent-runtime` conectam com `PG_USER`, o `POSTGRES_USER` do container.
  Ele é **superuser e dono das tabelas**.
- A RLS vale onde o código faz `withWorkspace` / `with_workspace` (`SET LOCAL ROLE hm_app`).
  O `FORCE ROW LEVEL SECURITY` (0062) não alcança superuser.
- Todo caminho `getDb()` direto (cerca de 29 arquivos na API e 24 nos workers, fora testes)
  roda com poder total: lê qualquer tenant, faz DDL, `COPY … TO PROGRAM` (execução de comando
  no container do Postgres), `ALTER ROLE`.
- Um bug de SQL ou uma injeção num desses caminhos não é um vazamento entre tenants: é o
  banco inteiro. Também tira a última trava da outbox: o superuser pode derrubar os CHECKs.

## Alvo

| Papel (LOGIN) | Usado por | Atributos | Membro de |
| --- | --- | --- | --- |
| `PG_USER` (atual) | só as migrações (passo 6 do `deploy.sh`, container efêmero) e o operador | superuser, dono | — |
| `hm_api_login` | `api` | NOSUPERUSER, NOBYPASSRLS, não é dono | `hm_app`, `hm_api_system` |
| `hm_workers_login` | `workers` | NOSUPERUSER, não é dono; BYPASSRLS só na etapa 1 | `hm_app`, `hm_outbox_relay`, `hm_workers_system` |
| `hm_runtime_login` | `agent-runtime` | NOSUPERUSER, NOBYPASSRLS | `hm_app` |

- `hm_app_login` (0062) existe e já é NOSUPERUSER/NOBYPASSRLS, mas é **um** papel para
  API e workers. Os workers precisam de `hm_outbox_relay` (ler e marcar a outbox de todos os
  tenants), e a API **nunca** pode tê-lo (F70-S16). Por isso são dois papéis de login.
- `hm_*_system` (NOLOGIN): os privilégios explícitos dos caminhos cross-tenant legítimos,
  tabela a tabela, com policy `TO hm_*_system` onde a tabela tem FORCE RLS. Nada de
  BYPASSRLS no alvo final.

## Plano (expand/contract, sem janela de indisponibilidade)

1. **Inventário** (slot de análise, sem código): listar cada `getDb()` direto por serviço e
   classificar:
   - (a) devia ser `withWorkspace` → corrigir;
   - (b) cross-tenant legítimo (schedulers, relay, billing, plataforma, resolução de webhook
     por `phone_number_id`, auth) → tabelas e operações exatas que ele usa.
   Sai daqui a lista de GRANTs de `hm_api_system` e `hm_workers_system`.
2. **Migração aditiva:** cria os papéis NOLOGIN (como a 0062 fez com `hm_app_login`), os
   `hm_*_system` com os GRANTs do inventário, policies `TO hm_*_system` nas tabelas com
   FORCE RLS, `GRANT hm_outbox_relay TO hm_workers_login` e `ALTER DEFAULT PRIVILEGES` para
   as tabelas novas. Nada muda para quem conecta hoje.
3. **Senhas fora do versionamento:** `PG_API_PASSWORD`, `PG_WORKERS_PASSWORD`,
   `PG_RUNTIME_PASSWORD` no `.env` do servidor;
   `ALTER ROLE … LOGIN PASSWORD …` rodado pelo operador (runbook da etapa).
4. **Troca por serviço, um deploy por vez:** o `DATABASE_URL` sai do bloco `x-app-env` e
   vira um por serviço no compose. Ordem: `agent-runtime` (só `with_workspace`, menor risco),
   depois `workers` (etapa 1 ainda com BYPASSRLS, para não depender do inventário perfeito),
   depois `api`. Em cada troca: testes de integração da suíte daquele serviço rodando com o
   papel novo em CI; em produção, `SELECT current_user, rolsuper, rolbypassrls` no health e
   observação dos logs de `permission denied` por 24 h.
5. **Contract:** tirar o BYPASSRLS de `hm_workers_login` quando os caminhos cross-tenant
   estiverem todos cobertos por `hm_workers_system`. Depois, o `PG_USER` só aparece no
   `deploy.sh` (migrações) e no acesso do operador.

## Rollback

Em qualquer etapa: apontar o `DATABASE_URL` do serviço de volta para `PG_USER` e rodar o
deploy. Os papéis novos ficam, sem LOGIN (`ALTER ROLE … NOLOGIN`), até a próxima tentativa.

## Verificação (quando feito)

```sql
SELECT usename, application_name, count(*)
  FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1, 2;
-- nenhuma conexão de api/workers/agent-runtime com o PG_USER
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'hm_%login';
```
