import { Component, type ErrorInfo, type ReactNode } from "react";

interface SectionBoundaryProps {
  children: ReactNode;
  /** Nome da seção, usado apenas para log de diagnóstico. */
  name?: string;
  /** Fallback opcional. Por padrão não renderiza nada (degradação silenciosa). */
  fallback?: ReactNode;
}

interface SectionBoundaryState {
  hasError: boolean;
}

/**
 * ErrorBoundary por seção.
 *
 * A landing é vista majoritariamente no celular, onde animações pesadas
 * (orbital com `perspective`, cards 3D arrastáveis, WebGL/three) podem falhar
 * em devices específicos. Sem contenção, um erro em UMA seção derruba TODA a
 * árvore React abaixo do `<Suspense>` e o usuário vê um "glitch"/tela quebrada.
 *
 * Este boundary isola cada seção: se a filha lançar, renderiza o `fallback`
 * (por padrão NADA) em vez de propagar. O resto da página continua intacto.
 */
export class SectionBoundary extends Component<
  SectionBoundaryProps,
  SectionBoundaryState
> {
  constructor(props: SectionBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): SectionBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Diagnóstico em dev; em produção degrada em silêncio.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error(
        `[SectionBoundary${this.props.name ? `:${this.props.name}` : ""}]`,
        error,
        info.componentStack,
      );
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
