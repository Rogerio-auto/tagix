/**
 * Service worker do Leadium (F61-S01).
 *
 * ## Por que este arquivo é escrito ao contrário do usual
 *
 * Um service worker é o único código do produto que **sobrevive ao deploy**. Se
 * uma versão quebrada chegar em produção, ela continua servindo do cache — para
 * usuários que nunca vão receber a correção, porque a correção chega por uma rede
 * que este arquivo intercepta. Não existe "reverter o deploy" para isso.
 *
 * Então a ordem aqui é: primeiro a saída de emergência, depois o cache. Um SW que
 * não acelera nada é um inconveniente; um SW que não sai é um incidente sem fim.
 *
 * ## As três garantias
 *
 * 1. **Dá para desligar.** `/sw-kill.json` com `disabled: true` faz este worker se
 *    apagar, limpar tudo e devolver os clientes à rede.
 * 2. **Nunca serve dado de negócio velho.** `/api`, `/auth` e `/socket.io` são
 *    rede pura, sem exceção (ver `sw-strategy.js`).
 * 3. **Nunca troca de versão no meio da sessão.** Sem `skipWaiting` automático:
 *    trocar o código sob os pés de quem está respondendo um cliente é como
 *    recarregar a página sozinho.
 */

import { chooseStrategy, describeRequest } from './sw-strategy.js';

/**
 * Versão do cache. Trocar esta string invalida TODO o cache anterior no próximo
 * `activate` — é o botão de "limpa tudo" quando algum asset entrar corrompido.
 */
const VERSAO = 'leadium-v1';
const CACHE = `${VERSAO}-assets`;

/** Onde a checagem de desligamento mora, e de quanto em quanto tempo. */
const KILL_URL = '/sw-kill.json';
const KILL_INTERVALO_MS = 6 * 60 * 60 * 1000;

let ultimaChecagemKill = 0;

/**
 * Desliga o worker de vez: limpa os caches, sai do registro e recarrega quem
 * estiver com a página aberta. É o caminho de volta quando algo dá errado.
 */
async function autodestruir() {
  const nomes = await caches.keys();
  await Promise.all(nomes.map((n) => caches.delete(n)));
  await self.registration.unregister();
  const clientes = await self.clients.matchAll({ type: 'window' });
  for (const c of clientes) c.navigate(c.url);
}

/**
 * Consulta o interruptor. Falha de rede NÃO desliga nada — o padrão seguro aqui
 * é continuar funcionando, porque desligar por causa de um 4G ruim tiraria o
 * cache justamente de quem mais precisa dele.
 */
async function checarKillSwitch(forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimaChecagemKill < KILL_INTERVALO_MS) return;
  ultimaChecagemKill = agora;
  try {
    const res = await fetch(KILL_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json();
    if (body && body.disabled === true) await autodestruir();
  } catch {
    // Sem rede ou resposta inválida: segue vivo, de propósito.
  }
}

self.addEventListener('install', () => {
  // Nada é pré-cacheado. Pré-cache exige saber os nomes com hash do build, o que
  // acoplaria este arquivo ao pipeline do Next; o ganho real vem do cache-first
  // em `/_next/static`, que se preenche sozinho na primeira visita.
  //
  // Sem `skipWaiting()`: a versão nova espera a próxima navegação.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await checarKillSwitch(true);
      // Apaga cache de versões anteriores — senão o disco do celular vira um
      // museu de builds.
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((n) => n.startsWith('leadium-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Guarda no cache, ignorando falha de quota — cache cheio não pode virar erro. */
async function guardar(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {
    // Quota estourada ou resposta não-cacheável: seguir sem cachear.
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  await guardar(request, res);
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    await guardar(request, res);
    return res;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const rede = fetch(request)
    .then(async (res) => {
      await guardar(request, res);
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    // Atualiza atrás sem segurar a resposta.
    semRejeicao(rede);
    return hit;
  }
  const res = await rede;
  if (res) return res;
  return fetch(request);
}

/** Consome uma promise pendente sem deixar rejeição não tratada. */
function semRejeicao(promise) {
  void Promise.resolve(promise).catch(() => undefined);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  let estrategia;
  try {
    estrategia = chooseStrategy(describeRequest(request, self.location.origin));
  } catch {
    // Erro na decisão não pode virar tela branca: cai para a rede.
    return;
  }

  // `network-only` não chama `respondWith`: deixa o navegador seguir o caminho
  // normal, sem este worker no meio. É mais barato e menos arriscado que
  // reimplementar um passthrough.
  if (estrategia === 'network-only') return;

  event.respondWith(
    (async () => {
      semRejeicao(checarKillSwitch());
      try {
        if (estrategia === 'cache-first') return await cacheFirst(request);
        if (estrategia === 'network-first') return await networkFirst(request);
        return await staleWhileRevalidate(request);
      } catch {
        // Última linha: qualquer falha inesperada no handler vira a rede crua.
        return fetch(request);
      }
    })(),
  );
});

/**
 * Ativação sob demanda: a página pode pedir a troca de versão quando o usuário
 * aceitar. Nunca por conta própria.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
  if (event.data === 'kill') event.waitUntil(autodestruir());
});
