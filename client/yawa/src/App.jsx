// src/App.jsx
import React, { useState, useEffect } from 'react'
import LoginForm from './components/LoginForm'
import RegisterForm from './components/RegisterForm'
import UserDashboard from './components/UserDashboard'
import './index.css'

const SplashScreen = () => (
  <div className="splash-screen">
    <h1 className="splash-title">Welcome</h1>
    <p className="splash-subtitle">Academic Performance Management</p>
  </div>
);

function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [users, setUsers] = useState([{ username: 'admin', password: 'password123' }]);
  const [currentView, setCurrentView] = useState('login');
  const [currentUser, setCurrentUser] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

useEffect(() => {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}, []);

useEffect(() => {
  if (message.text) {
    // Start a timer to clear the message after 3 seconds
    const messageTimer = setTimeout(() => {
      setMessage({ text: '', type: '' });
    }, 3000); 

    // Clean up the timer if the user submits again quickly
    return () => clearTimeout(messageTimer);
  }
}, [message.text]);

  const handleLogin = (credentials) => {
    setMessage({ text: '', type: '' });
    const match = users.find(u => u.username === credentials.username && u.password === credentials.password);
    if (match) {
      setCurrentUser(match);
      setCurrentView('dashboard');
    } else {
      setMessage({ text: 'Invalid username or password.', type: 'error' });
    }
  };

  const handleRegister = (newUser) => {
    setMessage({ text: '', type: '' });
    if (users.some(u => u.username === newUser.username)) {
      setMessage({ text: 'Username already taken.', type: 'error' });
    } else {
      setUsers([...users, newUser]);
      setMessage({ text: 'Account created! Please log in.', type: 'success' });
      setCurrentView('login');
    }
  };

  return (
    <div className={`main-app ${currentView === 'dashboard' ? 'in-dashboard' : 'in-auth'}`}>
      {showIntro && <SplashScreen />}
      
      {message.text && (
        <div className={`feedback-text ${message.type === 'error' ? 'error-text' : 'success-text'}`}>
          {message.text}
        </div>
      )}

      {currentView === 'dashboard' ? (
        <UserDashboard user={currentUser} onLogout={() => { setCurrentUser(null); setCurrentView('login'); }} />
      ) : (
        <div className="auth-scroll-container">
          
          <div className="auth-content-wrapper">
            {currentView === 'login' && (
              <LoginForm onLoginAttempt={handleLogin} onSwitchToRegister={() => setCurrentView('register')} />
            )}
            {currentView === 'register' && (
              <RegisterForm onRegisterSuccess={handleRegister} onSwitchToLogin={() => setCurrentView('login')} />
            )}
          </div>

          <footer className="auth-footer">
            <div className="footer-content">
              <h3>About CoreSync Academics</h3>
              <p>
                CoreSync is an advanced academic performance management system. It is designed to streamline 
                subject analytics, track student performance metrics, and identify at-risk trends early 
                to ensure academic success.
              </p>
              <div className="dev-team">
                <h4>Development Team</h4>
                <p>Proudly engineered and designed by a team of <strong>3 dedicated developers</strong>.</p>
              </div>
              <div className="footer-copyright">
                &copy; {new Date().getFullYear()} CoreSync Academic Systems. All rights reserved.
              </div>
            </div>
          </footer>

        </div>
      )}
    </div>
  )
}

export default App