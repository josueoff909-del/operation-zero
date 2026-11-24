import { defineConfig } from 'vite';

// Vite — dev server acessível na rede (preview Arena) e no celular via IP local.
// Em produção (build), o jogo é 100% estático e pode ser servido por qualquer host.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true, // permite o host do preview (Arena) e o IP local no celular
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
