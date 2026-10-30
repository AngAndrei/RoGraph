import React from 'react';import {createRoot} from 'react-dom/client';import App from './App.js';import {bootstrapSession} from './api.js';import './styles.css';bootstrapSession();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
