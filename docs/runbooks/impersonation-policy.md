# Runbook — Política de View-as (Impersonation)

> **Feature:** F26 — Platform Tenant Management · Pilar C.
> **Audiência:** super-admins de plataforma (operação/suporte/CTO).
> **Status:** v1 — **view-as READ-ONLY** (sem act-as/escrita; act-as é fase futura).

View-as deixa um super-admin ver o produto **pelos olhos de um tenant**, para suporte e
debug, **sem poder escrever nada**. É a única feature que dá a um humano acesso aos dados
de produção de um cliente — por isso é tratada como operação sensível de compliance, não
conveniência.

## Quando usar

- Investigar um relato do cliente ("minha conversa não aparece", "o agente respondeu errado").
- Reproduzir um bug que só acontece no contexto/dados daquele tenant.
- Validar uma configuração (canais, agentes, pipeline) que o cliente reportou.

**Não use** para: alterar dados do tenant (é read-only — e a escrita está bloqueada no
backend), exportar PII, ou "dar uma olhada" sem motivo. Todo acesso é auditado.

## Invariantes de segurança (garantidas pelo backend, F26-S05)

1. **Read-only duro.** O middleware de impersonation bloqueia **qualquer** método não-GET
   com `403 impersonation_read_only`. Não há caminho de escrita durante view-as.
2. **Sem plataforma, sem secrets.** Durante a sessão, rotas `/api/platform/*` e qualquer
   rota de secret retornam `403 impersonation_forbidden_route`. Tokens/secrets nunca
   cruzam a fronteira de visualização (o 360 e o view-as só mostram metadados).
3. **Time-boxed.** A sessão expira automaticamente (TTL de 30 min). Após expirar, o claim
   é ignorado e o admin volta ao contexto normal — sem reentrada automática.
4. **Anti-tampering.** O claim (cookie `hm_impersonation`) só vale para o **mesmo** admin
   que o abriu, e ele precisa continuar sendo `is_platform_admin`. Claim de outro member
   → `403 impersonation_claim_rejected`.
5. **Auditoria total (LGPD).** Início e fim vão para `audit_logs` (`actor_type=platform_admin`,
   `action=impersonation.started|ended`) com `reason`, `ip`, `user_agent`, workspace-alvo.

## Como usar (passo a passo)

1. Painel → **Tenants** → abra o **Workspace 360** do tenant.
2. Clique em **Ver como**. Informe um **motivo** (obrigatório, mínimo 5 caracteres — é a
   justificativa LGPD de acesso a PII do titular). Ex.: "investigar ticket #1234".
3. A sessão abre; o app de workspace carrega no contexto do tenant com um **banner global
   persistente** ("Vendo como {workspace} · read-only · Sair") em todas as telas.
4. Navegue e investigue. Tentativas de escrita falham (botões de escrita não têm efeito;
   a API responde 403). Isso é esperado.
5. Ao terminar, clique em **Sair** no banner (kill-switch). A sessão encerra e o cookie é
   limpo. Você volta ao painel.

## Encerrar / kill-switch

- **Sair** no banner encerra a sessão corrente.
- Painel → **Ver como** lista todas as sessões ativas; qualquer uma pode ser encerrada ali.
- Sessões expiram sozinhas em 30 min mesmo sem ação.

## LGPD & compliance

- O `reason` registrado em `audit_logs` é a base legal/justificativa do acesso. Seja
  específico (ticket, contexto). Acesso sem propósito documentado é violação de política.
- A auditoria é a trilha que prova **quem** acessou **o quê**, **quando** e **por quê** —
  exigência da LGPD para acesso a dados do titular. Nunca apague linhas de `audit_logs`.

## Limitações conhecidas (v1)

- **Sem escrita (act-as):** corrigir dados pelo tenant não é possível em v1. Se precisar,
  oriente o cliente ou abra um follow-up para a fase act-as (elevação explícita + TTL menor).
- O banner identifica o workspace por id; a resolução de nome amigável é incremental.
