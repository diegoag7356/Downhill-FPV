import { defineConfig } from 'vite';

// Hosts extra para la previsualización en la nube. Se pasan por entorno
// (VITE_ALLOWED_HOSTS=a,b) para no fijar el hostname de la VM en el repo.
const extraHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  server: { allowedHosts: extraHosts },
});
