import React, { useState, useEffect } from 'react'
import UserDashboard from './components/UserDashboard'
import './App.css'
import './index.css'

const SplashScreen = () => (
  <div className="splash-screen">
    <div className="splash-badge">YW</div>
    <h1 className="splash-title">Y.W Acad System</h1>
    <p className="splash-subtitle">Academic Performance Management</p>
  </div>
);

function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  return (
    <div className={`main-app ${showDashboard ? 'in-dashboard' : 'in-landing'}`}>
      {showIntro && <SplashScreen />}

      {showDashboard ? (
        <UserDashboard onGoBack={() => setShowDashboard(false)} />
      ) : (
        <div className="landing-container">
          <div className="landing-content">
            <div className="landing-brand">
              <div className="landing-logo">YW</div>
              <h1 className="landing-title">Y.W Acad System</h1>
              <p className="landing-subtitle">Academic Performance Management</p>
            </div>
            <button className="landing-cta" onClick={() => setShowDashboard(true)}>
              Go to Dashboard
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
          <footer className="landing-footer">
            <p>&copy; {new Date().getFullYear()} Y.W Acad System. All rights reserved.</p>
            <p>Engineered by a team of 3 dedicated developers</p>
          </footer>
        </div>
      )}
    </div>
  )
}

export default App