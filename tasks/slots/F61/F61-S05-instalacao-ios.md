---
id: F61-S05
title: Instalação no iPhone — detecção de standalone e convite honesto
phase: F61
status: in-progress
priority: critical
estimated_size: M
depends_on: [F61-S01]
blocks: [F61-S03]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-09-09T22:03:30Z

---
# F61-S05 — Instalação no iPhone

## Objetivo

Levar o dono do negócio de "abri o site no Safari" para "tenho o app na tela de início" —
porque no iOS **nada do resto funciona sem isso**.

## Contexto

`APP_MOBILE_PLAN` §2/§5. Este slot não é cosmético: no iOS, o Safari só entrega
**Web Push** e só registra o **service worker em modo standalone** para um site que foi
adicionado à tela de início. A F61-S01 subiu o worker e a F61-S03 vai subir o push; os dois
ficam inertes no iPhone enquanto o cliente estiver com o site aberto numa aba.

### O que o iOS não dá

`beforeinstallprompt` **não existe no Safari**. Não há API para pedir instalação, nem para
detectar se o usuário está prestes a instalar. O único caminho é Compartilhar → Adicionar à
Tela de Início, feito à mão pelo usuário.

Isso muda o desenho: no Android/desktop dá para oferecer um botão que instala; no iOS a única
coisa honesta é **ensinar**, com o ícone certo e o número de toques certo. Um botão "Instalar"
que abre um texto explicativo é pior que nenhum botão — promete uma ação e entrega uma aula.

### O que dá para detectar

| Sinal | Onde |
|---|---|
| `matchMedia('(display-mode: standalone)')` | padrão, funciona no iOS 16+ |
| `navigator.standalone === true` | legado da Apple, ainda o mais confiável no iOS |
| `beforeinstallprompt` | Chromium apenas — quando dispara, dá para instalar de verdade |

## Escopo

### files_allowed

- `apps/web/shared/pwa/**`
- `apps/web/features/today/**`
- `apps/web/app/(app)/hoje/**`

### files_forbidden

- `apps/web/public/sw.js`
- `apps/api/**`

## Escopo (faz)

1. **`usePwaInstall()`** — devolve `{ standalone, plataforma, podeInstalar, instalar }`.
   Reconhece iOS Safari, Chromium (com prompt real) e "já instalado".
2. **Convite na tela Hoje**, não global. Quem instala é o dono que abre no semáforo; pedir
   instalação numa tela de configuração no desktop é pedir na hora errada.
3. **Instruções iOS com o ícone real de Compartilhar**, em três passos numerados. Nada de
   "adicione aos favoritos do seu navegador".
4. **Botão de verdade no Chromium** via `beforeinstallprompt` capturado.
5. **Não insistir.** Dispensado, some por 14 dias (`localStorage`). Instalado, nunca mais
   aparece. E permanece acessível quando o usuário quiser voltar.

## Fora de escopo

- Push (F61-S03) — este slot só cria a condição para ele existir.
- Onboarding assistido por vídeo/link enviado ao cliente: vale slot próprio se a taxa de
  instalação for baixa; medir antes de construir.

## Definition of Done

- [ ] Em modo standalone o convite NUNCA aparece.
- [ ] No iOS aparecem instruções, não um botão que não instala.
- [ ] No Chromium aparece botão real e ele instala.
- [ ] Dispensa dura 14 dias e sobrevive a recarregar.
- [ ] `localStorage` indisponível (aba privada) não quebra a tela.
- [ ] Nenhum termo de navegador que o dono não usa ("PWA", "manifest", "service worker").

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o cliente instala sozinho, sem ligar para o suporte.
