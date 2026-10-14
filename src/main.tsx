import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LanguageProvider } from './i18n'

if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname))) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, { once: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
)
