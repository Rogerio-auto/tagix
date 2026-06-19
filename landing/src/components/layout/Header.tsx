import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FiMenu, FiX } from "react-icons/fi";
import clsx from "clsx";

import { Button } from "../ui/Button";
import { Wordmark } from "../ui/Wordmark";
import { NAV_LINKS } from "../../utils/constants";
import { REDIRECT_URLS } from "../../utils/redirect";

const LOGIN_URL = `${REDIRECT_URLS.app}/login`;

const Brand = () => (
  <Link to="/" className="flex items-center" aria-label="Leadium — página inicial">
    <Wordmark className="text-2xl" />
  </Link>
);

export const Header = () => {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const handleNavClick = () => setOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Brand />

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground lg:flex">
          {NAV_LINKS.map((link) => {
            const isAnchor = link.path.includes("#");
            const baseClasses = clsx(
              "transition-colors hover:text-primary",
              location.pathname === link.path.replace(/#.*/, "") && !isAnchor && "text-primary",
            );

            return isAnchor ? (
              <a key={link.label} href={link.path} className={baseClasses}>
                {link.label}
              </a>
            ) : (
              <Link key={link.label} to={link.path} className={baseClasses}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Button variant="ghost" size="sm" asChild>
            <a href={LOGIN_URL} className="font-semibold transition-colors hover:text-primary">Entrar</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/demo">Ver Demo</Link>
          </Button>
          <Button size="sm" asChild>
            <a href="/#precos">Começar Grátis</a>
          </Button>
        </div>

        <button
          className="inline-flex items-center rounded-full border border-border p-2 text-foreground lg:hidden"
          onClick={() => setOpen((state) => !state)}
          aria-label="Abrir menu"
        >
          {open ? <FiX className="text-xl" /> : <FiMenu className="text-xl" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/40 bg-background/95 px-4 py-4 shadow-lg lg:hidden backdrop-blur-md">
          <nav className="flex flex-col gap-3 text-sm font-medium text-muted-foreground">
            {NAV_LINKS.map((link) =>
              link.path.includes("#") ? (
                <a key={link.label} href={link.path} onClick={handleNavClick}>
                  {link.label}
                </a>
              ) : (
                <Link key={link.label} to={link.path} onClick={handleNavClick}>
                  {link.label}
                </Link>
              ),
            )}
          </nav>
          <div className="mt-4 flex flex-col gap-3">
            <Button variant="outline" className="w-full" onClick={handleNavClick} asChild>
              <a href={LOGIN_URL}>Acessar Conta</a>
            </Button>
            <Button variant="secondary" onClick={handleNavClick} asChild>
              <Link to="/demo">Ver Demo</Link>
            </Button>
            <Button onClick={handleNavClick} asChild>
              <a href="/#precos">Ver Planos</a>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
};
