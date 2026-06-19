import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { HERO } from "../../utils/constants";

/**
 * CTA fixo no rodapé do mobile — aparece após o usuário rolar para fora do hero.
 * Some no desktop (lg:hidden) e respeita a área segura (safe-area-inset).
 */
export const StickyMobileCTA = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.9);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/85 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md lg:hidden"
        >
          <a
            href={HERO.ctaPrimary.href}
            className="flex h-14 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-brand to-brand-strong text-base font-bold uppercase tracking-wider text-[var(--text-on-brand)] shadow-glow-md"
          >
            {HERO.ctaPrimary.label}
            <ArrowRight className="h-4 w-4" />
          </a>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
