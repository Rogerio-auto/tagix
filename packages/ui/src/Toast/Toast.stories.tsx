import { Button } from '../Button/Button';
import { ToastProvider, useToast } from './Toast';

function Demo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="primary"
        onClick={() => toast({ variant: 'success', title: 'Salvo', description: 'Alterações aplicadas.' })}
      >
        Success
      </Button>
      <Button
        variant="danger"
        onClick={() => toast({ variant: 'error', title: 'Falha ao enviar', description: 'Janela de 24h da Meta fechou.' })}
      >
        Error
      </Button>
      <Button
        variant="secondary"
        onClick={() => toast({ variant: 'warn', title: 'Atenção', description: 'Verifique os destinatários.' })}
      >
        Warn
      </Button>
      <Button
        variant="ghost"
        onClick={() => toast({ variant: 'info', title: 'Dica', description: 'Use Cmd+K para buscar.' })}
      >
        Info
      </Button>
    </div>
  );
}

export const Variants = () => (
  <ToastProvider>
    <Demo />
  </ToastProvider>
);
