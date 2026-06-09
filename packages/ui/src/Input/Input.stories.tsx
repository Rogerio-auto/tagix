import { Input } from './Input';

export const Default = () => (
  <div className="max-w-sm">
    <Input label="Nome" placeholder="Como você quer ser chamado" />
  </div>
);

export const WithHint = () => (
  <div className="max-w-sm">
    <Input label="Nome" placeholder="Seu nome" hint="Aparece nas conversas" />
  </div>
);

export const WithError = () => (
  <div className="max-w-sm">
    <Input label="Email" defaultValue="invalido" error="Email inválido" />
  </div>
);

export const Disabled = () => (
  <div className="max-w-sm">
    <Input label="Workspace" value="Acme" disabled readOnly />
  </div>
);

export const Sizes = () => (
  <div className="flex max-w-sm flex-col gap-3">
    <Input size="sm" placeholder="Small" />
    <Input size="md" placeholder="Medium" />
    <Input size="lg" placeholder="Large" />
  </div>
);
