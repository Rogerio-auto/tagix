import { cn } from "../../lib/utils";

type WordmarkProps = {
  className?: string;
};

/**
 * Wordmark textual da Leadium — editorial, limpo, dark-first.
 * O ponto final usa o verde-neon de marca como acento (1× por tela).
 */
export const Wordmark = ({ className }: WordmarkProps) => (
  <span
    className={cn(
      "font-display font-extrabold tracking-tight text-foreground select-none",
      className,
    )}
  >
    Leadium<span className="text-primary">.</span>
  </span>
);
