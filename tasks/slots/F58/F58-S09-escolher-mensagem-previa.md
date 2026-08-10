---
id: F58-S09
title: Escolher a mensagem com prévia e variáveis
phase: F58
status: available
priority: critical
estimated_size: M
depends_on: [F58-S05, F58-S06]
blocks: [F58-S12]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/DESIGN_SYSTEM.md
---

# F58-S09 — Escolher a mensagem com prévia e variáveis

## Objetivo

Eliminar o campo de nome técnico do template. O usuário escolhe um modelo
aprovado, vê exatamente o que será enviado, preenche as variáveis e testa no
próprio telefone antes de continuar.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/message/**`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/api/**`

## Definition of Done

- [ ] Picker lista somente modelos aprovados do canal, com busca, categoria e idioma.
- [ ] Preview de celular renderiza header, body, footer, mídia e botões sem executar HTML externo.
- [ ] Cada variável é mapeada para nome/campo do contato ou valor fixo, com exemplo real e fallback obrigatório.
- [ ] Sequência permite adicionar/reordenar mensagens e definir atraso em linguagem humana.
- [ ] **Enviar teste** mostra destinatário, loading, sucesso/falha e impede clique duplicado.
- [ ] Modelo pausado/rejeitado após seleção bloqueia avanço e oferece escolher outro/sincronizar.
- [ ] Testes cobrem template sem variável, múltiplos idiomas, mídia, botões e variável ausente.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm --filter @hm/web build
```

## Notas

- O payload final continua usando `templateName/languageCode/components`; essa tradução não deve aparecer para o usuário.
