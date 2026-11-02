import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export function mount(app: ReactNode): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
