'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Menu } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { PlatformMark } from './PlatformMark';
import { PlatformNav } from './PlatformNav';

/**
 * Navegação mobile do painel de super-admin (F36-S13; DS 3.0 na F72-S08). A sidebar fixa
 * só existe em `lg+`; abaixo disso o gatilho abre um bottom-sheet com a MESMA navegação
 * (`PlatformNav` em modo toque, alvos de 44px). Fecha ao trocar de rota.
 */
export function PlatformMobileNav() {
  const { isBelowDesktop } = useBreakpoint();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!isBelowDesktop) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegação de plataforma"
        aria-haspopup="dialog"
        className="touch-target -ml-2 grid place-items-center rounded-sm text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:focus-ring motion-reduce:transition-none lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        variant="bottom"
        title={<PlatformMark />}
        ariaLabel="Navegação de plataforma"
        footer={
          <Link
            href="/"
            className="flex min-h-11 items-center gap-3 rounded-sm px-3 font-head text-sm font-medium text-text-mid outline-none transition-colors duration-200 hover:bg-surface-2 hover:text-text focus-visible:focus-ring motion-reduce:transition-none"
          >
            <ArrowLeft className="size-4.5 shrink-0 text-text-low" aria-hidden />
            Voltar ao workspace
          </Link>
        }
      >
        <PlatformNav touch />
      </Sheet>
    </>
  );
}
