# Runbook — Instagram: opt-out por keyword + redação de PII

> **Escopo:** regras de compliance que o pipeline IG (F15-S03 inbound / F15-S04 outbound) aplica.
> Este doc é a fonte da verdade do *comportamento esperado*; a implementação mora no código.
> Referências: INSTAGRAM.md §15; LIVECHAT/CAMPAIGNS (paridade WhatsApp).

---

## 1. Opt-out por keyword (paridade IG ↔ WhatsApp)

### 1.1 Keywords

O Instagram usa **as mesmas keywords de opt-out do WhatsApp** — paridade total:

```
STOP, PARAR, SAIR, CANCELAR
```

Regra de match (igual ao WA): **match exato, case-insensitive, sobre o texto normalizado**
(trim + lowercase) da mensagem inbound. "PARAR agora" **não** dá opt-out (não é match exato);
"  parar  " **dá** (após trim). Isso evita opt-out acidental por menção da palavra no meio de frase.

### 1.2 Efeito

Ao detectar opt-out numa DM inbound IG:

1. Marca o contato como opted-out (mesmo campo/flag de contato usado por WA — sem coluna nova).
2. Bloqueia **outbound proativo** (campanhas / `MESSAGE_TAG`) para esse contato.
3. Atendimento humano reativo dentro da janela permanece possível conforme política Meta,
   mas disparos automáticos cessam.

### 1.3 Onde aplica

- **Inbound (F15-S03):** detecta a keyword ao persistir a DM e seta o opt-out.
- **Outbound (F15-S04) e Campanhas:** checam o opt-out antes de enfileirar/despachar; contato
  opted-out → bloqueio com erro tipado, sem envio.

> **IG é mais restritivo que WA por natureza:** outbound proativo a quem nunca DM'ou é proibido
> pela Meta (INSTAGRAM.md §11.2), e fora de 7d sem interação o envio é impossível mesmo com tag.
> O opt-out é uma camada adicional sobre essas regras de janela.

## 2. Redação de PII em logs (igsid / username)

### 2.1 Regra

`igsid` (Instagram-Scoped ID do contato) e `username` (@handle) são **PII** e **nunca** devem
aparecer em claro nos logs estruturados. A redação usa o mesmo mecanismo de `redact` do Pino
já configurado no `@hm/logger` — estendido com os paths IG.

### 2.2 Paths a redigir

Cobrir os pontos onde esses campos transitam em logs (inbound parse, persistência, outbound,
comments). Exemplos de paths/keys a marcar como redigidos:

```
*.igsid
*.from_ig_user_id
*.fromIgsId
*.username
*.from_username
*.fromUsername
*.contactRemoteId   // é o IGSID no contexto IG
```

> O valor redigido aparece como `[REDACTED]` (ou `***`) — o suficiente para correlação não fica
> exposto. `webhook_events.raw_payload` é persistido no banco (retenção 30d, INSTAGRAM.md §17)
> para replay/debug, **mas não é logado** em claro.

### 2.3 Por que importa

- **LGPD / Meta Platform Terms:** PII de usuários finais não pode vazar em logs/observability.
- **App Review:** demonstrar tratamento responsável de dados reforça a aprovação de
  `instagram_manage_messages` / `instagram_manage_comments`.

## 3. Checklist de verificação

- [ ] Mensagem inbound `parar` (qualquer caixa, com espaços) → contato opted-out; `PARAR agora` → não.
- [ ] Contato opted-out → campanha/`MESSAGE_TAG` bloqueados com erro tipado (sem envio).
- [ ] Logs de inbound/outbound/comments **não** contêm igsid/username em claro (grep nos logs de teste).
- [ ] `webhook_events.raw_payload` persiste o bruto, mas o logger não o emite em claro.
