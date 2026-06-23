---
id: F47-S10
title: Reorg da Sidebar — perfil do usuário + logout + nav
phase: F47
status: available
priority: medium
estimated_size: S
depends_on: []
blocks: [F47-S11]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.4 — logout e perfil com path óbvio (rodapé da sidebar), não escondidos."
  - "Aplica 2.7 — logout com feedback imediato (loading) + redirect limpo."
  - "Aplica 2.9 — logout é reversível (re-login), confirmação simples ou direta."
  - "Aplica 8 (mobile) — paridade: identidade/sessão acessível no mobile (TopBar/BottomNav)."
---

# F47-S10 — Sidebar mais profissional: perfil do usuário + logout

## Objetivo

Reorganizar a sidebar principal: adicionar o **perfil do usuário** (nome + role + avatar) e o
**botão de logout** no rodapé, organizar melhor a navegação e dar polish profissional — sem exagero.

## Contexto

A `Sidebar` hoje só tem logo + lista de nav. Identidade e sessão não têm lugar. `auth.store` fornece
`name` e `role`; logout reusa o endpoint de sessão da API (`POST /auth/logout` — confirmar a rota
exata em `apps/api/src/auth/routes.ts`). Theme toggle vive na `TopBar`.

## Escopo (faz)

- Rodapé da sidebar com **bloco de perfil**: avatar (iniciais se sem foto), nome, role; abre um
  **UserMenu** (perfil → `/settings` (pessoal), logout). Ícones universais permitidos (perfil) §2.4.
- **Logout**: chama `POST /auth/logout`, limpa auth store + caches, redireciona p/ `/login`
  (reusar o mecanismo de expiry/purge se já existir; senão, mínimo: clear + replace).
- **Organização da nav**: agrupar visualmente (ex.: separar "operação" de "configuração"/ajuda) com
  divisória sutil — sem inventar destinos novos (espelha `nav.ts`). Polish: espaçamento, hierarquia,
  estados hover/active consistentes (DS v2, sem hex).
- **Paridade mobile**: garantir que perfil + logout estejam acessíveis no mobile (TopBar ou no
  overflow "Mais" da BottomNav) — não deixar a feature só no desktop.

## Fora de escopo

- Tela de edição de perfil (já existe em settings). Mudar a matriz de nav/permissões.
  Backend de logout (já existe). Avatar upload.

## Arquivos permitidos

- `apps/web/shared/components/layout/Sidebar.tsx`
- `apps/web/shared/components/layout/nav.ts` (só se precisar metadados de agrupamento)
- `apps/web/shared/components/layout/TopBar.tsx` (acesso a perfil/logout no mobile)
- `apps/web/shared/components/layout/UserMenu.tsx` (novo)
- `apps/web/shared/components/layout/BottomNav.tsx` (se existir, p/ paridade do logout no mobile)

## Arquivos proibidos

- `features/**` (conversations/contacts/pipeline/products/conversions/settings), `apps/api/**`,
  `packages/**`. A reorg é só na camada de layout.

## Definition of Done

- [ ] Sidebar mostra perfil (nome+role+avatar) e logout no rodapé; UserMenu abre/fecha (Esc/clique fora).
- [ ] Logout encerra a sessão (cookie), limpa estado e redireciona p/ login sem loop.
- [ ] Nav organizada com hierarquia clara; hover/active consistentes; sem hex hardcoded.
- [ ] Perfil + logout acessíveis no mobile; `pnpm typecheck` + `pnpm lint` + build verdes.

## Permission scope

- Sem gate novo (todo membro autenticado tem perfil + logout). Itens de nav seguem o gating atual.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Independente do resto da F47 (pode rodar em paralelo na onda A). Confirmar a rota/method exatos do
  logout em `apps/api/src/auth/routes.ts` antes de fiar. Avatar: se `auth.store` não expõe avatar,
  usar iniciais do nome (não inflar escopo com upload).
- "Sem exagero": polish de organização e hierarquia, não redesenho da identidade visual.
