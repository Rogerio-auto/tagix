import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from '../Button/Button';

export const Right = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Abrir detalhe</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Detalhe do negócio"
        description="Acme Corp — R$ 12.400"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary">Salvar</Button>
          </>
        }
      >
        <p className="text-sm text-text-mid">
          Painel lateral para detalhe de item (UX §2.3). No mobile ele colapsa para bottom-sheet.
        </p>
      </Drawer>
    </div>
  );
};

export const BottomSheet = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Abrir bottom-sheet</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side="bottom"
        title="Ações rápidas"
      >
        <div className="flex flex-col gap-2">
          <Button variant="ghost">Marcar como ganho</Button>
          <Button variant="ghost">Arquivar</Button>
        </div>
      </Drawer>
    </div>
  );
};
