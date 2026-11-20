import { createRoot } from 'react-dom/client';
import { AppUpdateNotice } from './components/AppUpdateNotice';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <AppUpdateNotice />
  </>
);
