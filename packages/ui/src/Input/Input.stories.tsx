import { ThemePair } from '../lib/ThemePair';
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

export const WithSuccess = () => (
  <div className="max-w-sm">
    <Input label="Domínio" defaultValue="sunrise.com.br" success="Domínio verificado" />
  </div>
);

/** Todos os estados do campo (maquete: foco, erro, sucesso, desabilitado, ajuda) nos dois temas. */
export const BothThemes = () => (
  <ThemePair>
    <div className="flex flex-col gap-4">
      <Input label="Padrão" placeholder="Digite aqui" hint="Visível para membros do cliente." />
      <Input label="Foco (forçado)" defaultValue="Sunrise Remodeling" className="border-brand shadow-glow-sm" />
      <Input label="Erro" defaultValue="invalido" error="Email inválido" />
      <Input label="Sucesso" defaultValue="sunrise.com.br" success="Domínio verificado" />
      <Input label="Desabilitado" defaultValue="Acme" disabled />
    </div>
  </ThemePair>
);
