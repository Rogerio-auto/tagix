import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Usado pelo Ladle (auto-detectado) para processar o Tailwind 4 das stories.
export default defineConfig({
  plugins: [tailwindcss()],
});
