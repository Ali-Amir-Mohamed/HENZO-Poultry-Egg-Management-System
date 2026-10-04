import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import './styles.css'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { DialogProvider } from './components/Dialog'
import { startAutoSync } from './lib/offlineQueue'

startAutoSync()

// The mouse wheel must never change a number field (scrolling the page over a focused
// quantity used to turn 2 into 1.12): the field loses focus and the page scrolls normally.
document.addEventListener('wheel', (e) => {
  const el = document.activeElement
  if (el?.type === 'number' && el === e.target) el.blur()
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
