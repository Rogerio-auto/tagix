---
id: F26-S11
title: Runbooks de plataforma + revisão de segurança da impersonation
phase: F26
status: done
priority: medium
depends_on: []
estimated_size: S
agent_id: security-auditor
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-13T15:20:55Z
completed_at: 2026-06-13T15:25:06Z

---
# F26-S11 — Runbooks + security review

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §6/§10
> **blocks:** —

## Objetivo

Dois runbooks operacionais + a revisão de segurança da feature mais sensível: `impersonation-policy.md` (quando/por que usar view-as, política LGPD, TTL, o que é read-only, auditoria, como encerrar) e `manage-tenant-subscription.md` (atribuir plano/override/trial pelo painel, efeito nos entitlements, pegadinhas). E a auditoria `/hm-security` do middleware de impersonation (F26-S05) — confirmar read-only de fato, no-secrets, no-leak, audit completo.

## Contexto

Itens transversais de compliance/operação. A parte de runbook pode rodar a qualquer momento; a auditoria de segurança da impersonation deve ser feita/revalidada **após** o F26-S05 mergear (o orchestrator agenda no fim da fase).

## Escopo (faz)

- `docs/runbooks/impersonation-policy.md` (novo): política de uso do view-as (LGPD, motivo obrigatório, TTL, read-only, auditoria, kill-switch, quem pode).
- `docs/runbooks/manage-tenant-subscription.md` (novo): gerir assinatura/override/trial pelo painel, efeito em `resolveEntitlements`, riscos.
- Relatório da auditoria `/hm-security` da impersonation (confirma: read-only real, sem escrita, sem secrets, sem acesso a platform routes, audit completo) — achados em `docs/security/` ou append no owasp-audit.

## Fora de escopo

- Código (é docs + auditoria read-only).

## Arquivos permitidos

- `docs/runbooks/impersonation-policy.md`
- `docs/runbooks/manage-tenant-subscription.md`
- `docs/security/**`

## Arquivos proibidos

- Código de produção.

## Definition of Done

- [ ] 2 runbooks acionáveis e coerentes com o painel/middleware reais da F26.
- [ ] Auditoria de segurança da impersonation registrada; qualquer achado high/critical vira follow-up explícito (ou é corrigido em hotfix de S05).

## Validação

```bash
test -f docs/runbooks/impersonation-policy.md
test -f docs/runbooks/manage-tenant-subscription.md
```

## Notas

- Executor: **security-auditor** (read-only) + docs. A auditoria pressupõe F26-S05 mergeado — orchestrator roda por último.
