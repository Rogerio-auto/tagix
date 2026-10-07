---
id: F70-S37
title: Lista e cabeçalho da conversa mostram o nome do contato, não o número
phase: F70
status: done
priority: high
estimated_size: S
ui: true
depends_on: [F70-S36]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S36-nome-do-perfil-do-contato.md
  - docs/UX_PRINCIPLES.md
agent_id: backend-engineer
claimed_at: 2026-10-07T17:41:11Z
completed_at: 2026-10-07T18:10:05Z

---
# F70-S37 — Lista e cabeçalho da conversa mostram o nome do contato

## Objetivo

Na inbox, cada conversa aparece com o nome da pessoa, na hierarquia do Rogério: **nome salvo no sistema → nome do perfil do WhatsApp/Instagram → telefone formatado** (este só quando não há nome nenhum). Nunca o id cru.

## Escopo (faz)

- Resolvedor único e testado (`apps/web/features/conversations/contact-label.ts`): `contactLabel({ displayName, profileName, remoteId, channel })`.
  - Ignora nome vazio ou só com espaços.
  - Telefone formatado para leitura: BR `+55 (69) 99967-0030`, outros países no formato internacional. Para Instagram sem nome, `@usuario` se houver; senão "Contato do Instagram".
  - Devolve também a fonte (`system | profile | phone`), para a UI poder sinalizar.
- `ChatListItem`:
  - nome pelo resolvedor;
  - iniciais do avatar a partir do nome (não do número; com nome, primeira letra de até 2 palavras);
  - quando o nome vem do sistema e o do perfil é diferente, nada extra na lista (lista enxuta);
  - `title` com o telefone, para conferência.
- `ConversationHeader`: mesmo resolvedor; telefone formatado como subtítulo quando o título é um nome.
- `ContactInfoPanel`: mostra "Nome no WhatsApp: X" (ou Instagram) quando `profileName` existe e difere do nome do sistema. Se não há nome no sistema, oferece "Usar este nome" (salva em `display_name` pelo endpoint de edição de contato que já existe).
- Busca da lista: o placeholder reflete que busca por nome também, se a S36 ligou isso.
- Tipos (`ConversationSummary`, `ConversationDetail`) com os campos novos da S36.

### files_allowed

- `apps/web/features/conversations/**`
- `apps/web/e2e/specs/conversations*.spec.ts` (novos) e `apps/web/e2e/fixtures/api-mock.ts` (só os campos novos do mock de conversas)

## Definition of Done

- [ ] testes do resolvedor: sistema > perfil > telefone; vazio/espaços; BR e internacional; Instagram
- [ ] teste de componente: lista e cabeçalho mostram nome; sem nome → telefone formatado
- [ ] e2e (API mockada): a lista exibe o nome
- [ ] capturas 375/1440 dark+light, axe sem violação séria (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `/hm-designer`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/conversations --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.

## Revisão de design (/hm-designer, revisor delegado)

APROVADO COM RESSALVAS. B1 (aviso não sumia após "Usar este nome": cache de conversas/detalhe) corrigido, junto com F1 (iniciais ignoram preposições) e F5 (comparação de nome sem caixa/acento). Follow-ups abertos: F2 ícone de pessoa no avatar sem nome (hoje '#'); F3 cor determinística de avatar (slot de DS); F4 telefone visível na lista para homônimos; F7 contraste do selo "IA" no claro; a11y `nested-interactive` (serious, preexistente: `li role=option` com `<a>`; trocar para nav/ul). Fixture de e2e: `contactDisplayName` espelha o remoteId para não quebrar specs que acham o item pelo número (pom.ts/seed.ts fora de files_allowed). Capturas 375/1440 dark+light na scratchpad da sessão; axe sem violação nova.
