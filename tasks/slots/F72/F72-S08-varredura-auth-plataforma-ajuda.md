---
id: F72-S08
title: Varredura de auth, painel de plataforma, ajuda e páginas públicas no DS 3.0
phase: F72
status: review
priority: medium
estimated_size: M
ui: true
depends_on: [F72-S02, F72-S03]
blocks: [F72-S09]
source_docs:
  - docs/features/DS3_ADOCAO.md
  - docs/design/ds-3.0-agency-os.html
agent_id: backend-engineer
claimed_at: 2026-10-16T14:12:08Z
completed_at: 2026-10-16T16:53:20Z

---
# F72-S08 — Auth, plataforma, ajuda e páginas públicas

## Objetivo

As telas fora do shell do app também falam DS 3.0: login, cadastro, verificação, reset, convite, o painel de plataforma inteiro, a Central de Ajuda e as páginas públicas (termos, privacidade, exclusão de dados).

## Escopo (faz)

- `(auth)`: login, signup, verify (H1 acompanha o estado "Verifique seu email", ressalva da F71-S09), reset-password, convite. A marca vive no logotipo SVG (sem Orbitron).
- `(platform)` e `features/platform-admin`: tenants, 360, planos, assinaturas, modelos, políticas, segredos, uso, monitoring, playground, suporte e help. Tabelas com o `DataTable`. Aqui custo de IA é legítimo (o admin pode agir).
- `features/help` e `(app)/help`.
- `(public)`: termos, privacidade e exclusão de dados, com tipografia editorial de leitura longa.

### files_allowed

- `apps/web/app/(auth)/**`, `apps/web/features/auth/**`
- `apps/web/app/(platform)/**`, `apps/web/features/platform-admin/**`
- `apps/web/app/(app)/help/**`, `apps/web/features/help/**`, `apps/web/shared/components/help/**`
- `apps/web/app/(public)/**`
- `apps/web/e2e/specs/{auth,signup,invite,platform,help}*.spec.ts`

## Definition of Done

- [ ] todas as telas listadas no DS 3.0, nos dois temas, 375/1440
- [ ] e2e de auth, convite e plataforma verdes
- [ ] axe sem violação séria
- [ ] revisão `/hm-designer` (login e Workspace 360 obrigatórios)

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/auth features/platform-admin features/help --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.

## Notas de execução

- 2 sub-lotes sequenciais: (a) auth (login, signup, verify, reset, convite) + aceite de convite (`features/invites/components/{InviteView,CreatePasswordForm}.tsx`, desvio autorizado) + `(public)` + Central de Ajuda; (b) painel de plataforma (14 telas). + rodada de correção do portão de design/segurança + ressalvas finais. Detalhe em `tasks/COMMS.md` (F72 lote C).
- Telas no DS 3.0, 375/1440, dark/light, axe sem violação séria, contraste ≥4,5, captura em `apps/web/e2e/.artifacts/f72-s08/`: specs `e2e/specs/{auth-ds3,help-ds3,platform-ds3}.spec.ts`.
- e2e de auth, convite e plataforma verdes (`auth`, `invite`, `signup-terms`, `help-support`, `members-invites`, `closed-panels-a11y`, `session-expired`, + os 3 novos: 191/191 na rodada de correção; platform-ds3 64/64 final). Suíte inteira 619/621 (2 intermitentes fora do escopo, verdes isoladas).
- Lint: platform-admin 11 → 0; `eslint apps/web` 44 → 33 avisos, 0 erros.
- `/hm-designer` (login e Workspace 360 obrigatórios): REPROVADO (2 bloqueantes) → corrigido → APROVADO COM RESSALVAS → ressalvas fechadas.
- Segurança (fluxo de senha/auth): APROVADO COM RESSALVAS; LOW-1 (Referer com token), LOW-2 (Zod na exclusão de dados), LOW-3 (servidor de teste em loopback) corrigidos.
