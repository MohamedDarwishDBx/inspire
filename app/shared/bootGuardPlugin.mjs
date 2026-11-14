import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Inlines bootGuard.js into every page's <head>, before the app's module script, so the guard runs even when the module graph fails.
const GUARD = readFileSync(fileURLToPath(new URL('./bootGuard.js', import.meta.url)), 'utf8');
if (GUARD.includes('</script')) throw new Error('bootGuard.js must not contain a closing script tag');

export default function bootGuard() {
  return {
    name: 'inspire-boot-guard',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/<head>/i, () => `<head>\n    <script>\n${GUARD}</script>`),
    },
  };
}
