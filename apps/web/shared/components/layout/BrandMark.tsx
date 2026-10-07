import { cn } from '@/shared/lib/cn';

/**
 * Marca do produto no topo da Sidebar (altura = TopBar, 68px, para as duas
 * hairlines alinharem). É o único bloco preenchido de marca da casca; o resto da
 * nav usa a marca só como acento.
 */
export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        'flex h-17 shrink-0 items-center gap-3',
        collapsed ? 'justify-center px-0' : 'px-5',
      )}
    >
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-sm bg-brand font-head text-base font-bold text-text-on-brand"
      >
        T
      </span>
      {!collapsed && (
        <span className="font-head text-lg font-bold tracking-tight text-text">tagix</span>
      )}
    </div>
  );
}
