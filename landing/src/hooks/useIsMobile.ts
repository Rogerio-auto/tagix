import { useEffect, useState } from "react";

/**
 * Retorna true quando a viewport está abaixo do breakpoint (default 768px).
 * Usado para desligar/reduzir efeitos pesados (partículas, WebGL) no celular —
 * a landing é vista principalmente no mobile e não pode travar.
 */
export const useIsMobile = (breakpoint = 768): boolean => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
};
