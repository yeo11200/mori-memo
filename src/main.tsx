import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { QuickNote } from './app/QuickNote';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.hash === '#quick-note' ? <QuickNote /> : <App />}</React.StrictMode>);
