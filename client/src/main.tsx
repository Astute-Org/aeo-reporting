import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './ui/Toast';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
