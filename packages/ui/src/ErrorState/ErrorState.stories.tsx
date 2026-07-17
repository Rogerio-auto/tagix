import { ErrorState } from './ErrorState';
import { Button } from '../Button/Button';

export const Full = () => (
  <ErrorState
    title="Falha ao enviar mensagem"
    reason="A janela de 24h da Meta fechou para este contato."
    whatToDo="Use um template aprovado para reabrir a conversa."
    reference="hm_err_abc123"
    action={<Button variant="secondary">Tentar de novo</Button>}
  />
);

export const Minimal = () => (
  <ErrorState
    title="Algo deu errado"
    action={<Button variant="secondary">Recarregar</Button>}
  />
);

export const WithReferenceOnly = () => (
  <ErrorState
    title="Não foi possível carregar o painel"
    reason="Nosso servidor demorou a responder."
    reference="hm_err_9f21c7"
  />
);
