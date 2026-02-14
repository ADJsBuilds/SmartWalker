import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import { CvPage } from './pages/CvPage';
import { RealtimeStateProvider } from './store/realtimeState';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RealtimeStateProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/cv" element={<CvPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RealtimeStateProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
