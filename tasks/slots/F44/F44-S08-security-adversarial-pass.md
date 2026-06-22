---
id: F44-S08
title: Pass final /hm-security + /hm-adversarial + testes de integracao de fluxo
phase: F44
status: done
priority: high
estimated_size: M
depends_on: [F44-S04, F44-S05, F44-S06, F44-S07]
blocks: []
agent_id: security-auditor
security_review: required
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
claimed_at: 2026-06-22T19:04:35Z
completed_at: 2026-06-22T19:09:19Z

---
# F44-S08 [SEC] — Pass final de seguranca + adversarial

> source_docs: docs/features/SELF_SERVE_SIGNUP.md §3 (T1–T14)
> depends_on: S04, S05, S06, S07 (tudo integrado). blocks: nenhum.

## Objetivo

Auditoria final do fluxo completo de cadastro self-serve: /hm-security + /hm-adversarial
cobrindo todo o threat model T1–T14, mais testes de integracao do fluxo end-to-end
(signup -> verify -> login) no nivel de API/integration (nao Playwright).

## Escopo (faz)

- Rodar /hm-security e /hm-adversarial mentalmente/manualmente sobre o codigo integrado das
  rotas + provider + provisioner + UI. Tentar quebrar de proposito: enumeracao por timing,
  bypass de captcha, mass-signup, injecao de role/workspaceId/isPlatformAdmin no body, signup
  parcial sem rollback, open-redirect, vazamento de segredo no bundle (grep por SUPABASE_SERVICE
  e similares no output do build do web), email descartavel passando.
- Adicionar testes de integracao de fluxo (somente em arquivos de teste — sem novos
  files_allowed de PRODUCAO): signup uniforme + idempotente, rollback de provisionamento,
  verify ativa member, reset uniforme, rate-limit, sem platform-admin no member criado.
- Produzir o relatorio de achados (severidade + fix) como saida do slot. Achados ALTOS/CRITICOS
  viram correcao no slot de origem (abrir nota em COMMS, nao corrigir fora do files_allowed sem sub-slot).

## Fora de escopo

- Codigo de producao novo (so testes). Mudanca de schema. Deploy/merge na main.

## Arquivos permitidos

- apps/api/src/auth/flow.integration.test.ts (novo)
- apps/api/src/auth/routes.test.ts (acrescentar casos)
- docs/features/SELF_SERVE_SIGNUP.md (anexar secao de achados, opcional)

## Arquivos proibidos

- Qualquer arquivo de PRODUCAO (.ts nao-teste) — achados viram sub-slot/correcao no slot de origem.

## Definition of Done

- [ ] T1–T14 revisados um a um com veredito (coberto/gap) e evidencia.
- [ ] Bundle do web auditado por segredo (grep SUPABASE_SERVICE/secret no build) — limpo.
- [ ] Testes de integracao de fluxo verdes (signup/verify/login, rollback, rate-limit, no-platform-admin).
- [ ] Relatorio de achados entregue; ALTOS/CRITICOS encaminhados ao slot de origem.
- [ ] pnpm typecheck + pnpm lint + suites de @hm/api e @hm/web verdes.

## Validacao

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/web build
```

## Notas

- Especialista: security-auditor. Este e o gate final da fase — nada vai para integracao humana
  com achado ALTO/CRITICO aberto.
