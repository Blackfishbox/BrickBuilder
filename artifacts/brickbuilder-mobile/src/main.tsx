import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { registerPwa } from '@/app/registerPwa';
import { applyColorTheme, readColorTheme } from '@/platform/color-theme';

import './index.css';
import './dark-theme.css';

applyColorTheme(readColorTheme());
registerPwa();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
