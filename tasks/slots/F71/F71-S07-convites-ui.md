---
id: F71-S07
title: Tela de aceitar convite e gestão de membros com convites pendentes
phase: F71
status: blocked
priority: high
estimated_size: M
ui: true
depends_on: [F71-S05]
blocks: [F71-S10]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
---
# F71-S07 — Convites (UI)

## Objetivo

A pessoa convidada abre o link e entra em poucos segundos. O admin vê e controla os convites: pendentes, reenviar, revogar, copiar link e reativar quem foi removido.

## Escopo (faz)

- `/convite/[token]` (rota pública, grupo `(auth)`, adicionada a `PUBLIC_PREFIXES`):
  - carrega o preview: "Fulano convidou você para a **Empresa** como Atendente";
  - **sem conta:** nome + senha (mesmas regras de força e o mesmo medidor do signup) → aceitar → `/login?email=…` com aviso "Conta criada. Entre com sua senha.";
  - **com conta, logado com o email certo:** um botão "Entrar na Empresa" → empresa ativa → `/`;
  - **com conta, deslogado:** "Entre para aceitar" → `/login?next=/convite/<token>`;
  - **logado com outro email:** explica e oferece sair e entrar com o email certo;
  - inválido/expirado: estado claro, sem detalhar o motivo, com "peça um novo convite a quem te convidou";
  - ignora o fragmento `#access_token` que o Supabase anexa e o remove da URL.
- Seção Membros (`MembersSection.tsx`):
  - lista de membros com status legível (Ativo, Removido, Bloqueado) e filtro "mostrar removidos";
  - lista de convites pendentes: email, papel, enviado há X, expira em Y; ações Reenviar, Copiar link (clipboard + toast) e Revogar (confirmação);
  - modal de convite: email, papel (sem OWNER) e departamento opcional; erro de limite de membros com CTA para billing;
  - toast "Convite enviado para x@y.com" só depois do 201;
  - reativar membro removido (`PATCH status:'active'`), também sujeito ao limite.
- Estados vazio, carregando e erro em tudo (UX_PRINCIPLES). Mobile 375px. Tokens do DS v2, sem hex.

### files_allowed

- `apps/web/app/(auth)/convite/**`
- `apps/web/features/invites/**` (novo)
- `apps/web/features/settings/sections/workspace-org/MembersSection.tsx`, `apps/web/features/settings/sections/workspace-org/queries.ts`
- `apps/web/shared/lib/public-routes.ts`
- testes ao lado (`*.test.tsx`) e `apps/web/e2e/specs/invite*.spec.ts` (novos; fixtures compartilhadas são da S10)

### files_forbidden

- `apps/web/features/auth/**`, `apps/web/app/(auth)/{login,signup,verify}/**` (S09), `apps/web/shared/components/layout/**` (S08)

## Definition of Done

- [ ] testes de componente dos 5 estados da tela de convite
- [ ] testes da seção de membros: reenviar, revogar, copiar, limite estourado
- [ ] e2e `invite.spec.ts` do aceite sem conta (com API mockada)
- [ ] capturas 375/768/1440 em dark e light, axe sem violação séria, orçamento de peso (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `design-web` / `/hm-designer` aprovada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run features/invites features/settings shared/lib --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
