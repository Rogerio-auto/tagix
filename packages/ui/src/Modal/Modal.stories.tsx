import { useState } from 'react';
import { Button } from '../Button/Button';
import { Modal } from './Modal';

export const Confirmation = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Excluir agente
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Excluir agente?"
        description="Esta ação não pode ser desfeita."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="font-body text-sm text-text-mid">
          O agente e seu histórico de execuções serão removidos permanentemente.
        </p>
      </Modal>
    </>
  );
};

/** Já aberto, para revisão visual/captura (portal segue o toggle de tema do Ladle). */
export const OpenByDefault = () => (
  <Modal
    open
    onClose={() => undefined}
    title="Excluir agente?"
    description="Esta ação não pode ser desfeita."
    footer={
      <>
        <Button variant="ghost">Cancelar</Button>
        <Button variant="danger">Excluir</Button>
      </>
    }
  >
    <p className="font-body text-sm text-text-mid">
      O agente e seu histórico de execuções serão removidos permanentemente.
    </p>
  </Modal>
);
