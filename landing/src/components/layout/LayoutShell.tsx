import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { ScrollToTop } from "./ScrollToTop";
import { Button } from "../ui/Button";

export const LayoutShell = () => {
  // DS v2: dark é o padrão da landing; toggle usa data-theme
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, [isDark]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollToTop />
      <Header />
      <main className="relative z-0">
        <Outlet />
      </main>
      <Footer />

      {/* Toggle de tema — fixo no canto */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-background/80 backdrop-blur border-border hover:border-primary/50"
          onClick={() => setIsDark(!isDark)}
        >
          {isDark
            ? <Sun className="h-5 w-5 text-[var(--brand)]" />
            : <Moon className="h-5 w-5 text-[var(--text-low)]" />
          }
        </Button>
      </div>
    </div>
  );
};
