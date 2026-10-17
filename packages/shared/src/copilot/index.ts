/**
 * `@hm/shared` · Copiloto (F73-S02). Contrato único entre API, runtime (por espelho) e web.
 *
 * Tudo aqui é puro (Zod + funções sem IO) e seguro no navegador. As fixtures ficam fora do
 * barrel de propósito: são insumo de mock e teste, e não devem entrar no bundle de produção
 * por acidente. Consumo pelo subpath `@hm/shared/copilot/fixtures` (entrada a criar em
 * `package.json > exports`, junto de `@hm/shared/copilot`; o `package.json` ficou fora da
 * fronteira da F73-S02 e a entrada é do primeiro consumidor, F73-S03 ou F74-S01).
 */
export * from './capabilities';
export * from './risk';
export * from './statuses';
export * from './contracts';
export * from './internal';
