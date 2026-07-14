import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import Landing from './pages/Landing';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import GmailOAuthCallback from './pages/GmailOAuthCallback';

const ADMIN_EMAIL = 'arjun.resumeai@gmail.com';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u || null));
  }, []);

  if (user === undefined) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #d6d3d1', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  );

  const isAdmin = user?.email === ADMIN_EMAIL;

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} replace /> : <Landing />} />
      <Route path="/onboarding" element={user ? <Onboarding /> : <Navigate to="/" replace />} />
      <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/" replace />} />
      <Route path="/admin" element={user ? <Admin /> : <Navigate to="/" replace />} />
      <Route path="/oauth/callback" element={<GmailOAuthCallback />} />
    </Routes>
  );
}
