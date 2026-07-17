import { Trash2, Pencil, MoreVertical, X, Star } from 'lucide-react';
import { IconButton } from './IconButton';

export const Variants = () => (
  <div className="flex items-center gap-3">
    <IconButton aria-label="Editar" icon={<Pencil />} variant="ghost" />
    <IconButton aria-label="Mais opções" icon={<MoreVertical />} variant="solid" />
    <IconButton aria-label="Excluir" icon={<Trash2 />} variant="danger" />
    <IconButton aria-label="Favoritar" icon={<Star />} variant="link" />
  </div>
);

export const Sizes = () => (
  <div className="flex items-center gap-3">
    <IconButton aria-label="Fechar pequeno" icon={<X />} size="sm" />
    <IconButton aria-label="Fechar médio" icon={<X />} size="md" />
    <IconButton aria-label="Fechar grande" icon={<X />} size="lg" />
  </div>
);

export const States = () => (
  <div className="flex items-center gap-3">
    <IconButton aria-label="Salvando" icon={<Star />} loading />
    <IconButton aria-label="Indisponível" icon={<Trash2 />} variant="danger" disabled />
  </div>
);
