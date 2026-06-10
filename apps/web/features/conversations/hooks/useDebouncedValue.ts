'use client';

import { useEffect, useState } from 'react';

/**
 * Retorna `value` com atraso — só propaga depois que parar de mudar por `delayMs`.
 * Usado pela busca da ChatList para não disparar uma query por tecla (UX §2.7).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
