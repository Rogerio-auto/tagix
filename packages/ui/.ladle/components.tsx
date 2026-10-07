import type { GlobalProvider } from '@ladle/react';
import { useEffect } from 'react';
import './styles.css';

// Aplica o data-theme do DS conforme o toggle de tema do Ladle. O tema também vai
// para <html>: Modal, Drawer, Toast e HelpPanel renderizam em portal no <body>,
// fora deste wrapper, e herdariam sempre o tema escuro sem isso.
export const Provider: GlobalProvider = ({ children, globalState }) => {
  const theme = globalState.theme === 'light' ? 'light' : 'dark';
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  return (
    <div data-theme={theme} className="min-h-dvh bg-bg font-body text-text">
      <div className="p-8">{children}</div>
    </div>
  );
};
