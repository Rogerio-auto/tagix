---
id: F58-S01
title: Definir nomes simples e o fluxo guiado de campanhas
phase: F58
status: done
priority: high
estimated_size: S
depends_on: []
blocks: [F58-S02, F58-S06]
agent_id: agent-f58-s01
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/UX_PRINCIPLES.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-08-10T16:00:27Z
completed_at: 2026-08-10T16:03:12Z

---
# F58-S01 — Definir nomes simples e o fluxo guiado de campanhas

## Objetivo

Atualizar o contrato de produto antes do código, substituindo termos técnicos por
nomes que expliquem a decisão do usuário. O novo criador deve falar em **Envio
único**, **Sequência de mensagens**, **Público**, **Mensagem**, **Quando enviar** e
**Revisão**, sem expor `broadcast`, `drip`, `rate` ou `tier` como conceitos primários.

## Escopo

### files_allowed

- `docs/features/CAMPAIGNS.md`
- `docs/features/WHATSAPP_MESSAGE_TEMPLATES.md`

### files_forbidden

- `apps/**`
- `packages/**`

## Definition of Done

- [ ] Jornada de cinco etapas documentada com objetivo, estados e saída de cada etapa.
- [ ] Glossário usuário → domínio técnico documentado (`Envio único` → `broadcast`, `Sequência` → `drip`).
- [ ] `triggered` não aparece para o usuário enquanto não houver runtime específico.
- [ ] Matriz de canal deixa claro que modelos aprovados pertencem ao WhatsApp oficial; Instagram e WAHA têm fluxos próprios.
- [ ] Central de **Modelos de mensagem do WhatsApp** documentada: sincronizar, criar, acompanhar aprovação e usar em campanha.
- [ ] Estados de loading, vazio, erro, permissão e canal desconectado têm texto acionável e sem jargão.

## Validação

```bash
pnpm exec prettier --check docs/features/CAMPAIGNS.md docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
```

## Notas

- A palavra técnica `template` pode existir em ajuda contextual, mas a interface principal usa **modelo de mensagem**.
- Não prometer criação para Instagram: HSM é recurso do WhatsApp oficial.
