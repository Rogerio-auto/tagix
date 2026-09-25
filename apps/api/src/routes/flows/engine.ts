/**
 * Engine de flows do processo da API.
 *
 * F70-S25: a engine não tem mais port de fila. O port de banco real grava o job de cada
 * step (`hm.q.flow.execution`) na OUTBOX, na mesma transação que cria ou avança a execução;
 * o relay dos workers publica depois do commit, com confirms. Antes a API injetava um
 * publisher próprio que publicava DEPOIS do commit: uma queda entre os dois deixava a
 * execução `running` sem passo, e um broker fora derrubava a rota com a execução já
 * gravada.
 *
 * Mantido como módulo próprio para ser o ponto único de composição da engine na API (as
 * rotas de flows e de submissões importam daqui, e os testes o substituem por um fake).
 */
import { createFlowEngine } from '@hm/flow-engine';

/** Engine de flows da API: createExecution real (DB/RLS) com o primeiro step na outbox. */
export const flowEngine = createFlowEngine();
