import { useEffect } from 'react';
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

/** Os quatro toasts já visíveis (duration 0) para revisão visual/captura. */
function Seed() {
  const { toast } = useToast();
  useEffect(() => {
    toast({ variant: 'success', title: 'Salvo', description: 'Alterações aplicadas.', duration: 0 });
    toast({ variant: 'error', title: 'Falha ao enviar', description: 'Janela de 24h da Meta fechou.', duration: 0 });
    toast({ variant: 'warn', title: 'Atenção', description: 'Verifique os destinatários.', duration: 0 });
    toast({ variant: 'info', title: 'Dica', description: 'Use Cmd+K para buscar.', duration: 0 });
  }, []);
  return null;
}

export const AllVariantsVisible = () => (
  <ToastProvider>
    <Seed />
  </ToastProvider>
);
