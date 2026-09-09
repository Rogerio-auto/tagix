---
id: F61-S05
title: Instalação no iPhone — detecção de standalone e convite honesto
phase: F61
status: review
priority: critical
estimated_size: M
depends_on: [F61-S01]
blocks: [F61-S03]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-09-09T22:03:30Z
completed_at: 2026-09-09T22:07:40Z

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

- [x] Em modo standalone o convite NUNCA aparece.
- [x] No iOS aparecem instruções, não um botão que não instala.
- [x] No Chromium aparece botão real e ele instala.
- [x] Dispensa dura 14 dias e sobrevive a recarregar.
- [x] `localStorage` indisponível (aba privada) não quebra a tela.
- [x] Nenhum termo de navegador que o dono não usa ("PWA", "manifest", "service worker").

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o cliente instala sozinho, sem ligar para o suporte.

## Decisões tomadas na execução (2026-09-09)

1. **No iOS o convite ENSINA; no Chromium ele INSTALA.** `beforeinstallprompt` não existe no
   Safari, então lá não há botão — há três passos numerados com o ícone real de Compartilhar.
   Um botão "Instalar" que abre um texto explicativo seria pior que nenhum botão: promete uma
   ação e entrega uma aula.

2. **Instalado vence tudo na ordem de decisão**, inclusive o prompt nativo. Um app instalado
   pedindo para ser instalado é a forma mais rápida de o produto parecer quebrado.

3. **`isStandalone` recebe os dois sinais já lidos, não `window`.** `navigator.standalone` é
   extensão da Apple e não existe no `lib.dom`; forçá-la na assinatura obrigaria um
   `as unknown as` no chamador. Quem lê do browser é o hook; quem decide é a função pura — e é
   a parte que tem teste.

4. **Duas fontes de "está instalado".** `display-mode: standalone` é o padrão e funciona no
   iOS 16+; `navigator.standalone` é o legado da Apple e ainda é o mais confiável no iOS.

5. **iPad é tratado como iOS mesmo se dizendo Macintosh.** O iPadOS 13+ manda user agent de Mac,
   e a única pista que sobra é `maxTouchPoints > 1`. Sem esse corte, ou o iPad não recebe
   instruções, ou todo Mac recebe instruções de iPhone. Há teste para os dois lados.

6. **`beforeinstallprompt` é interceptado com `preventDefault`.** Segurar o evento é o que
   permite oferecer o botão no nosso momento, em vez do banner do navegador aparecendo por cima
   do conteúdo.

7. **Ouvimos `change` do `display-mode`.** Instalar com a página aberta muda o modo sem
   recarregar; sem isso o convite continuaria na tela de quem acabou de instalar.

8. **Dispensa corrompida ou no futuro NÃO silencia.** Um `localStorage` sujo não pode enterrar
   o convite que destrava o push. O pior caso aceitável é mostrar o convite uma vez a mais.

9. **`localStorage` inacessível (aba privada) não quebra nada** — a dispensa passa a valer só
   para a sessão.

10. **O convite vive na tela Hoje, não no app inteiro.** Quem instala é o dono que abre o
    celular entre uma tarefa e outra; pedir instalação numa tela de configuração no desktop é
    pedir na hora errada, para a pessoa errada.

11. **Nenhuma palavra de navegador no texto.** Nada de "PWA", "manifest", "service worker" ou
    "adicionar aos favoritos". O texto diz o que o dono ganha: abrir direto e ser avisado
    quando entrar lead.

## Resultado

- 17 testes novos em `shared/pwa/install.test.ts`; suíte web 218/218.
- Typecheck limpo. Lint: 0 erros.
