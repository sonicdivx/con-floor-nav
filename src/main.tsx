import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { bindAppViewportHeight } from './lib/viewportHeight'
import { bindTourPersistLifecycle } from './lib/tourPersist'
import { initAppUpdateRegistration } from './lib/appUpdate'

bindAppViewportHeight()
bindTourPersistLifecycle()
initAppUpdateRegistration()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
