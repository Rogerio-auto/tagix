---
id: F72-S08
title: Varredura de auth, painel de plataforma, ajuda e páginas públicas no DS 3.0
phase: F72
status: in-progress
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
