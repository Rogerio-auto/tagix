'use client';

/**
 * Roteia a Central de Ajuda do membro (F38-S05): sem ?category mostra a home
 * (busca + categorias); com ?category mostra os artigos daquela categoria.
 */
import { useSearchParams } from 'next/navigation';
import { CategoryArticles } from './CategoryArticles';
import { HelpHome } from './HelpHome';

export function HelpReader() {
  const params = useSearchParams();
  const category = params.get('category');
  return category ? <CategoryArticles categoryId={category} /> : <HelpHome />;
}
