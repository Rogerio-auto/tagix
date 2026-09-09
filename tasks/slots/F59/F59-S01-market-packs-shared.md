---
id: F59-S01
title: Market pack como fonte única de regra por mercado
phase: F59
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: [F59-S02, F59-S04, F59-S06, F60-S01]
source_docs:
  - docs/features/AGENCIA_PLAN.md
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T05:21:25Z
completed_at: 2026-09-09T05:25:02Z

---
# F59-S01 — Market pack como fonte única de regra por mercado

## Objetivo

Criar em `@hm/shared` o contrato tipado que descreve um mercado (BR, US) — moeda, idiomas, fuso,
canais habilitados e **política de outbound por canal** — para que nenhuma regra de conformidade
precise virar `if (market === 'US')` espalhado pelo produto.

## Contexto

`AGENCIA_PLAN` §3.1 trava market pack como objeto de configuração único. Sem isso, o trabalho de dois
mercados apodrece em condicionais. Este slot é puro (sem DB, sem I/O) e desbloqueia F59-S02 (colunas),
F59-S04 (portão de consentimento) e a F60 inteira.

## Escopo

### files_allowed

- `packages/shared/src/markets.ts`
- `packages/shared/src/markets.test.ts`
- `packages/shared/src/index.ts`

### files_forbidden

- `packages/db/**`
- `apps/**`

## Contratos

```ts
export type MarketCode = 'BR' | 'US';
export type ChannelKind =
  | 'meta_whatsapp' | 'meta_instagram' | 'waha'
  | 'email' | 'sms' | 'webchat' | 'messenger';
export type MessagePurpose = 'transactional' | 'marketing';

export interface OutboundPolicy {
  /** Exige consentimento registrado ANTES do envio promocional. */
  readonly requiresPriorConsent: boolean;
  /** Janela local permitida, no fuso do CONTATO. `null` = sem restrição legal. */
  readonly quietHours: { readonly startHour: number; readonly endHour: number } | null;
  /** Revogação por qualquer meio razoável (não só palavra-chave). */
  readonly revocationByAnyReasonableMeans: boolean;
  /** Registro externo obrigatório antes do primeiro disparo (ex.: 10DLC). */
  readonly registrationRequired: 'none' | '10dlc';
  /** Palavras-chave de opt-out reconhecidas, minúsculas e sem acento. */
  readonly optOutKeywords: readonly string[];
}

export interface MarketPack {
  readonly code: MarketCode;
  readonly currency: 'BRL' | 'USD';
  readonly locales: readonly string[];       // BR: ['pt-BR'] · US: ['en-US','pt-BR']
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  readonly timezonePerContact: boolean;      // BR false · US true
  readonly channels: readonly ChannelKind[];
  readonly outbound: Readonly<Record<ChannelKind, OutboundPolicy>>;
}

export function getMarketPack(code: MarketCode): MarketPack;
export function getOutboundPolicy(code: MarketCode, channel: ChannelKind): OutboundPolicy;
export function isChannelEnabled(code: MarketCode, channel: ChannelKind): boolean;
export const MARKET_CODES: readonly MarketCode[];
```

## Definition of Done

- [ ] `markets.ts` exporta os tipos e as duas instâncias (`BR`, `US`) como `const` profundamente readonly, sem `any`.
- [ ] US: `timezonePerContact: true`, `locales: ['en-US','pt-BR']`, `currency: 'USD'`; SMS com `requiresPriorConsent: true`, `registrationRequired: '10dlc'`, `quietHours: { startHour: 8, endHour: 21 }` e `revocationByAnyReasonableMeans: true`.
- [ ] BR: `timezonePerContact: false`, `defaultTimezone: 'America/Sao_Paulo'`, `currency: 'BRL'`; canais sem SMS na lista habilitada.
- [ ] `optOutKeywords` cobre **os dois idiomas** em ambos os mercados (`stop`, `unsubscribe`, `cancel`, `quit`, `end`, `pare`, `parar`, `sair`, `cancelar`, `descadastrar`) — o público responde no idioma dele, não no do mercado.
- [ ] `getOutboundPolicy` é total: devolve política para todo `ChannelKind`, inclusive canal não habilitado no mercado (com `requiresPriorConsent: true` como padrão seguro).
- [ ] `isChannelEnabled` não é usado como gate de conformidade — só de disponibilidade de UI; documentado no JSDoc.
- [ ] Re-export em `packages/shared/src/index.ts`.
- [ ] Testes cobrem: totalidade de `getOutboundPolicy`, padrão seguro para canal desconhecido, e que nenhuma política de marketing em US tem `requiresPriorConsent: false`.

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/shared test
pnpm --filter @hm/shared lint
```

## Notas

- **Fatos regulatórios com fonte e data em `AGENCIA_PLAN` §4.** Não reinterpretar aqui: este slot só
  codifica o que aquele documento afirma.
- `quietHours` é `8..21` inclusive-exclusivo no fim (21h = já fora da janela). Documentar no tipo.
- O pacote é puro de propósito: nada de `Date.now()`, nada de leitura de env. Fuso é dado, não efeito.
