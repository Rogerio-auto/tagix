import { Inbox, SearchX, WifiOff } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Button } from '../Button/Button';

export const FirstRun = () => (
  <EmptyState
    icon={Inbox}
    title="Nenhuma conversa ainda"
    description="Quando um contato mandar mensagem, ela aparece aqui. Conecte um canal para começar."
    action={<Button variant="primary">Conectar canal</Button>}
  />
);

export const NoResults = () => (
  <EmptyState
    variant="no-results"
    icon={SearchX}
    title="Nada encontrado"
    description="Nenhum resultado para os filtros atuais. Ajuste a busca e tente de novo."
    secondaryAction={<Button variant="ghost">Limpar filtros</Button>}
  />
);

export const ErrorAdjacent = () => (
  <EmptyState
    variant="error-adjacent"
    icon={WifiOff}
    title="Não foi possível carregar"
    description="Verifique sua conexão. A lista volta assim que a rede se restabelecer."
    action={<Button variant="secondary">Tentar de novo</Button>}
  />
);
