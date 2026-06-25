---
id: F48-S04
title: Componente <Avatar> em @hm/ui (foto + fallback iniciais)
phase: F48
status: available
priority: high
estimated_size: S
depends_on: []
blocks: [F48-S05, F48-S06, F48-S08]
agent_id: frontend-engineer
source_docs:
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 3.6 — sem foto carregada não mostra quadro quebrado; cai em iniciais imediatas (sem flash)."
  - "Aplica 3.5 — quando interativo, cursor/hover ensinam; por padrão é apresentacional (não clicável)."
  - "Aplica 8 (mobile) — tamanhos em múltiplos de 4; alvo mínimo respeitado quando usado como botão."
---

# F48-S04 — <Avatar> reutilizável no Design System

## Objetivo

Criar o primitivo `<Avatar>` em `@hm/ui`: renderiza a foto (`src`) quando disponível e cai num
fallback de **iniciais** num círculo (estilo atual da ChatList) quando não há foto ou a imagem falha.
Reutilizável por leaderboard (S05), leads recentes (S06) e, no futuro, pela própria ChatList.

## Contexto

Hoje a ChatList desenha iniciais à mão (`size-10 rounded-pill bg-surface-3`). O Command Center v2
precisa de fotos reais (`members.avatar_url` / `contacts.avatar_url`). Centralizar num primitivo do DS
evita divergência visual e dá fallback consistente.

## Escopo (faz)

- `packages/ui/src/Avatar/Avatar.tsx`: props `{ src?: string|null; name?: string|null; size?: 'sm'|'md'|'lg'; className?: string }`.
  - Com `src` válido → `<img>` redondo, `object-cover`, `loading="lazy"`, `alt` = nome.
  - Sem `src` ou erro de carregamento (`onError`) → iniciais derivadas de `name` (até 2 chars,
    upper), círculo `bg-surface-3 text-text-mid font-head`.
  - Tamanhos: sm=24px, md=40px (igual à ChatList), lg=56px.
  - Tokens DS apenas (zero hex). `aria-hidden` na imagem decorativa quando há label textual ao lado;
    senão `alt` significativo.
- Exportar em `packages/ui/src/index.ts` (`export { Avatar }` + `export type { AvatarProps, AvatarSize }`).
- (Opcional) `Avatar.stories.tsx` com foto / sem foto / erro de carregamento.

## Fora de escopo

- Refatorar a ChatList para usar o Avatar (pode ser follow-up; não tocar `apps/web/**` aqui).
- Upload/edição de avatar.

## Arquivos permitidos

- `packages/ui/src/Avatar/**` (novo)
- `packages/ui/src/index.ts` (adicionar export)

## Arquivos proibidos

- `apps/web/**`, `packages/ui/src/**` exceto `Avatar/` e `index.ts`

## Contratos de saída

- `export function Avatar(props: AvatarProps): JSX.Element` — consumido por S05/S06/S08.

## Definition of Done

- [ ] Renderiza foto quando `src` ok; cai em iniciais quando `src` ausente OU `onError`.
- [ ] 3 tamanhos; md = 40px casa com a ChatList atual.
- [ ] Zero hex hardcoded; só tokens DS; `alt`/aria corretos.
- [ ] Exportado em `@hm/ui`; `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/ui ladle:build` verdes.

## UX considerations

- 3.6 (sem tela/quadro quebrado: fallback instantâneo de iniciais).
- 3.5 (cursor/hover só quando o consumidor o tornar interativo).
- 8 (tamanhos múltiplos de 4; bom alvo no mobile).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/ui ladle:build
```

## Notas

- `index.ts` é arquivo compartilhado do pacote, mas **nenhum outro slot desta feature toca @hm/ui** —
  então este slot é dono solitário do export. Manter ordem alfabética/agrupamento do arquivo.
