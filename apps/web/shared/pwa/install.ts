/**
 * Detecção de instalação do PWA (F61-S05) — lógica pura, testável sem DOM.
 *
 * ## Por que isto importa mais do que parece
 *
 * No iOS, o Safari só entrega **Web Push** e só roda o service worker em modo
 * standalone para um site que foi **adicionado à tela de início**. O worker da
 * F61-S01 e o push da F61-S03 ficam inertes enquanto o cliente estiver com o site
 * aberto numa aba. Instalar não é preferência estética: é a condição para o resto
 * existir no aparelho dele.
 *
 * ## O que o iOS não dá
 *
 * `beforeinstallprompt` **não existe no Safari**. Não há API para pedir instalação
 * nem para saber que o usuário está prestes a instalar. O único caminho é
 * Compartilhar → Adicionar à Tela de Início, feito à mão.
 *
 * Isso decide o desenho: no Chromium dá para oferecer um botão que instala de
 * verdade; no iOS a única coisa honesta é ensinar. Um botão "Instalar" que abre um
 * texto explicativo é pior que nenhum botão — promete uma ação e entrega uma aula.
 */

/** Como o convite deve se comportar neste aparelho. */
export type InstallPlatform =
  /** iPhone/iPad no Safari: só instruções, não há prompt programático. */
  | 'ios'
  /** Chromium: `beforeinstallprompt` existe e instala de verdade. */
  | 'prompt'
  /** Já está instalado, ou o navegador não instala nada. Não convidar. */
  | 'nenhum';

/** Quanto tempo uma dispensa vale. Duas semanas: lembra sem importunar. */
export const DISPENSA_DIAS = 14;
export const CHAVE_DISPENSA = 'leadium.pwa.dispensadoEm';

/**
 * Está rodando como app instalado?
 *
 * Recebe os dois sinais já lidos, em vez de receber `window`: mantém a função pura
 * e evita um cast — `navigator.standalone` é uma extensão da Apple que não existe
 * no `lib.dom`, e forçá-la na assinatura obrigaria um `as unknown as` no chamador.
 * Quem lê do browser é o hook; quem decide é isto aqui.
 *
 * Duas fontes porque nenhuma sozinha cobre: `display-mode: standalone` é o padrão
 * e funciona no iOS 16+; `navigator.standalone` é o legado da Apple e ainda é o
 * mais confiável no iOS. Basta uma dizer que sim.
 */
export function isStandalone(sinais: {
  displayMode: boolean;
  navigatorStandalone: boolean;
}): boolean {
  return sinais.navigatorStandalone || sinais.displayMode;
}

/**
 * iPhone ou iPad?
 *
 * O iPad moderno se identifica como Macintosh no user agent, e a única pista que
 * sobra é ter tela sensível ao toque. Sem isso, todo Mac veria instruções de
 * iPhone.
 */
export function isIOS(nav: { userAgent?: string; maxTouchPoints?: number }): boolean {
  const ua = nav.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/**
 * Decide o comportamento do convite.
 *
 * Ordem deliberada: instalado vence tudo (nunca convidar quem já instalou), depois
 * o prompt real, e o iOS por último — porque no iOS o convite é o plano B, não o
 * preferido.
 */
export function decidePlatform(input: {
  standalone: boolean;
  ios: boolean;
  temPromptNativo: boolean;
}): InstallPlatform {
  if (input.standalone) return 'nenhum';
  if (input.temPromptNativo) return 'prompt';
  if (input.ios) return 'ios';
  return 'nenhum';
}

/**
 * A dispensa ainda está valendo?
 *
 * Valor ausente, corrompido ou no futuro conta como "não dispensado". Um
 * `localStorage` sujo não pode esconder para sempre o convite que destrava o push
 * — o pior caso aceitável é mostrar o convite uma vez a mais.
 */
export function dispensaAtiva(bruto: string | null, agora: number): boolean {
  if (bruto === null) return false;
  const quando = Number(bruto);
  if (!Number.isFinite(quando) || quando <= 0) return false;
  if (quando > agora) return false;
  return agora - quando < DISPENSA_DIAS * 24 * 60 * 60 * 1000;
}
