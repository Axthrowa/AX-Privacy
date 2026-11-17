import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LANG } from '../shared/i18n.ts';

/** Renders the page; `title` replaces the Turkish one in the HTML file. */
export function mount(app: ReactNode, title?: string): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  document.documentElement.lang = LANG;
  if (title) document.title = title;
  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
