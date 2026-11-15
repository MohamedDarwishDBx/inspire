import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Puts bootGuard.js ahead of the app's module script in every page's <head>, so it runs even when the module graph fails.
// Dev server: inlined (no content security policy applies there). Build: a same-origin file under assets/, because the hosted
// App shell (and the demo runs that are App shells) send script-src 'self'-style policies that block inline scripts.
const FILE = 'assets/boot-guard.js';
const GUARD = readFileSync(fileURLToPath(new URL('./bootGuard.js', import.meta.url)), 'utf8');
if (GUARD.includes('</script')) throw new Error('bootGuard.js must not contain a closing script tag');

export default function bootGuard() {
  return {
    name: 'inspire-boot-guard',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FILE, source: GUARD });
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => {
        const tag = ctx?.server ? `<script>\n${GUARD}</script>` : `<script src="./${FILE}"></script>`;
        return html.replace(/<head>/i, () => `<head>\n    ${tag}`);
      },
    },
  };
}
