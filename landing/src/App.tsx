import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Suspense, lazy } from "react";

import { LayoutShell } from "./components/layout/LayoutShell";

// Lazy loading components
const Home = lazy(() => import("./pages/Home"));
const Pricing = lazy(() => import("./pages/Pricing"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Demo = lazy(() => import("./pages/Demo"));
const ThankYou = lazy(() => import("./pages/ThankYou"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const LGPD = lazy(() => import("./pages/LGPD"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Carregando spinner simples
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<LayoutShell />}>
            <Route index element={<Home />} />
            <Route path="precos" element={<Pricing />} />
            <Route path="sobre" element={<About />} />
            <Route path="contato" element={<Contact />} />
            <Route path="demo" element={<Demo />} />
            <Route path="obrigado" element={<ThankYou />} />
            <Route path="privacidade" element={<Privacy />} />
            <Route path="termos" element={<Terms />} />
            <Route path="lgpd" element={<LGPD />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
