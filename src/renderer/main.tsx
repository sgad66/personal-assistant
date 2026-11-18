import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/base.css'
import './styles/app.css'
import './styles/widgets.css'
import './styles/week.css'
import './styles/responsive.css'

const savedTheme = localStorage.getItem('pa-theme-v2')
document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
