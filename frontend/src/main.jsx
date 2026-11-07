import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { firebaseConfigurationError } from './firebase.js'
import ConfigurationError from './ConfigurationError.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {firebaseConfigurationError ? <ConfigurationError message={firebaseConfigurationError} /> : <App />}
  </StrictMode>,
)
