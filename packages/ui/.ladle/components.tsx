import type { GlobalProvider } from '@ladle/react';
import './styles.css';

// Aplica o data-theme do DS v2 conforme o toggle de tema do Ladle, e dá um
// fundo/cor coerentes com os tokens para todas as stories.
export const Provider: GlobalProvider = ({ children, globalState }) => (
  <div
    data-theme={globalState.theme === 'light' ? 'light' : 'dark'}
    className="min-h-dvh bg-bg font-body text-text"
  >
    <div className="p-8">{children}</div>
  </div>
);
