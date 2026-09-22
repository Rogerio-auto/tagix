---
id: F58-S05
title: Entregar a Central de Modelos do WhatsApp
phase: F58
status: review
priority: high
estimated_size: L
depends_on: [F58-S04]
blocks: [F58-S08]
agent_id: agent-f58-s05
source_docs:
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/DESIGN_SYSTEM.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-08-11T15:27:12Z
completed_at: 2026-09-22T20:57:35Z

---
# F58-S05 — Entregar a Central de Modelos do WhatsApp

## Objetivo

Dar ao administrador um lugar único para ver o que pode ser enviado, sincronizar
com a Meta, criar um modelo e entender por que ele ainda não está disponível.

## Escopo

### files_allowed

- `apps/web/app/(app)/settings/channels/[id]/message-templates/**`
- `apps/web/features/channels/message-templates/**`
- `apps/web/features/channels/components/ChannelListItem.tsx`

### files_forbidden

- `apps/api/**`
- `apps/web/features/campaigns/**`

## Definition of Done

- [x] Canal WhatsApp oferece ação **Modelos de mensagem**; Instagram/WAHA explicam por que não oferecem. *(`ChannelListItem`: link para quem tem `message_template.view`; nos outros canais, o motivo no lugar da ação)*
- [x] Lista mostra nome amigável, idioma, categoria, status e última sincronização. *(`MessageTemplatesCatalog` + `displayTemplateName`)*
- [x] Filtros e busca funcionam; estados vazio/loading/erro/permissão são acionáveis. *(busca com `useDeferredValue`, três filtros, "Limpar"; vazio × sem resultado × erro × sem permissão × canal desativado, cada um com ação)*
- [x] Botão **Sincronizar agora** mostra progresso e resumo sem duplicar itens. *(loading no botão, lista navegável durante a sincronização, resumo em toast e em `aria-live`)*
- [x] Formulário **Criar modelo** possui preview de celular, variáveis e validação inline. *(`CreateTemplateDrawer` + `TemplatePreview`; `validateDraft` cobre nome, idioma, tamanho, ordem das variáveis, exemplos e botões — 22 testes)*
- [x] Rejeição/pausa mostra motivo e próxima ação; aprovado oferece **Usar em campanha**. *(`TemplateDetailDrawer`: "O que fazer agora" por status, motivo da Meta destacado, "Criar versão corrigida" e o link para o criador)*
- [ ] Layout funciona em mobile e desktop com componentes/tokens do DS. *(classes responsivas e tokens em todo o arquivo, sem hex; **validação visual pendente** — conferir no navegador e no celular)*

## Resultado (2026-09-22)

**O código existia e estava perdido.** A implementação desta tela (10 arquivos, ~925 linhas) estava
num worktree de sessão anterior, **nunca commitada** e 195 commits atrás da `main`. Foi resgatada,
commitada como estava, e só então atualizada com a `main` — para o diff mostrar o que eu mudei.

**Nunca havia compilado.** O typecheck acusou `TS1005` em `CreateTemplateDrawer`: o texto de ajuda
escrevia `{{1}}, {{2}}` cru no JSX, que o TypeScript lê como expressão. Corrigido com escape.

**Faltavam testes.** `format.ts` é a lógica que decide se um modelo pode ser usado e o que vai para a
Meta; ganhou 22 testes (status desconhecido não vira "aprovado"; removido no provider não pode ser
usado; validação de variáveis, exemplos e botões; formato dos componentes; leitura tolerante do que
vem do provider).

**Locale fixo removido:** `Intl.DateTimeFormat('pt-BR')` quebraria o mercado americano; agora segue o
idioma de quem olha (regra do lint).

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm --filter @hm/web build
```

## Notas

- O usuário não precisa conhecer o identificador interno da Meta para operar esta tela.
- Neste slot, a criação oferece cabeçalho de texto; modelos de mídia sincronizados continuam visíveis na prévia. Upload de `header_handle` fica fora do MVP.
- **Usar em campanha** abre `/campaigns/new?channelId=...&messageTemplateId=...`; o consumo desses parâmetros pertence ao F58-S13.
