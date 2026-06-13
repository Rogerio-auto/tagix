# Security Audit — F26 View-as (Impersonation)

> **Escopo:** middleware `apps/api/src/middlewares/impersonation.ts` + API
> `apps/api/src/routes/platform/impersonation.ts` + wire em `app.ts` + ajuste de
> `middlewares/auth.ts` (F26-S05/S11). Revisão `/hm-security` pós-merge.
> **Veredito:** **APROVADO** — invariantes de read-only/no-secrets/no-platform/audit
> verificadas por teste e por leitura. Achados residuais abaixo (nenhum high/critical).

## Modelo de ameaça

A feature dá a um super-admin acesso de **leitura** aos dados de produção de um tenant.
As ameaças: (a) escalar para escrita; (b) vazar secrets/tokens; (c) alcançar a camada de
plataforma sob o disfarce do tenant; (d) usar um claim roubado/forjado; (e) sessão eterna;
(f) acesso sem trilha (LGPD).

## Invariantes verificadas

| # | Invariante | Mecanismo | Evidência |
|---|---|---|---|
| 1 | **Read-only duro** | middleware bloqueia todo método ≠ GET/HEAD → `403 impersonation_read_only` | teste `impersonation.test.ts` "POST -> 403 read_only"; leitura do middleware (linha do `req.method !== 'GET'`) |
| 2 | **Sem plataforma** | `isForbiddenPath` nega `/api/platform/*` → `403 forbidden_route` | teste "rota de plataforma -> 403" |
| 3 | **Sem secrets** | `isForbiddenPath` nega qualquer path com `/secret` → 403 | teste "rota de secret -> 403"; 360/view-as só serializam metadados (S02 testa no-secret-leak) |
| 4 | **Anti-tampering** | claim só vale p/ o mesmo `adminMemberId` E `isPlatformAdmin` | teste "claim usado por OUTRO member -> 403 rejected" |
| 5 | **Time-boxed** | `findActiveById` cruza `expires_at > now` E `ended_at is null`; TTL 30min | teste "sessao expirada -> no-op"; índice parcial `idx_impersonation_active` |
| 6 | **Auditoria (LGPD)** | start/end → `audit_logs` com `reason`, `ip`, `user_agent`, target | teste "POST ... audit gravado"; `reason` obrigatório (≥5 chars) no Zod |
| 7 | **Reversível/kill-switch** | DELETE encerra (idempotente, só o dono); cookie limpo | teste "DELETE encerra ... limpa cookie" |
| 8 | **Contexto correto** | override de `req.auth.workspace` p/ o alvo sobrevive ao requireAuth dos routers | `auth.ts`: requireAuth pula re-resolução quando `req.impersonation` ativo; teste de middleware com echo do workspace alvo |

## Defesa em profundidade

- **Início da sessão** exige `requirePlatformAdmin` (sessão + `is_platform_admin`).
- **Cookie de claim** (`hm_impersonation`) é `httpOnly` + `sameSite=lax` + `secure` em prod
  — não legível por JS, mitiga XSS-exfiltração do claim.
- **Plataforma sem RLS de tenant**: a impersonation resolve o workspace-alvo como owner,
  mas o middleware NUNCA dá acesso a `/api/platform/*` durante a sessão (invariante #2),
  então não há escalonamento de leitura para a camada de plataforma do alvo.
- **Front**: banner global persistente e inescapável (S09) + read-only explícito.

## Achados residuais (nenhum high/critical)

- **[LOW] Erro de escrita é genérico (403).** Tentativas de escrita durante view-as retornam
  `403 impersonation_read_only` sem distinguir CSRF de uso legítimo bloqueado — aceitável
  (read-only é a intenção). Sem ação.
- **[INFO] `isForbiddenPath` por substring `/secret`.** Cobre rotas atuais; uma rota futura
  cujo path contenha "secret" sem ser sensível seria bloqueada por engano (falha fechada —
  seguro). Reavaliar se surgir falso-positivo. Sem ação agora.
- **[INFO] Housekeeping de sessões expiradas** (`endExpired`) existe no repo mas não há job
  agendado; não é risco (o middleware já ignora sessões vencidas via `findActiveById`). 
  Follow-up opcional: cron de limpeza para higiene da tabela.
- **[FOLLOW-UP] act-as (escrita)** não existe (decisão v1). Quando entrar, exigirá: elevação
  explícita, TTL menor, marcação `acted_by_platform_admin` em cada escrita, e re-auditoria.

## Conclusão

As cinco invariantes big-tech de impersonation (read-only default, time-boxed, banner,
audit total, no-secrets) estão implementadas e testadas. Nenhum achado high/critical.
Aprovado para produção em v1 (view-as read-only).
