import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import './LoginPage.css';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  if (user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/operator'} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const loggedInUser = await login({ email, password });
      navigate(loggedInUser.role === 'admin' ? '/admin' : '/operator');
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-card">
          <div className="login-header">
            <Logo size={52} framed />
            <h1>Welcome back</h1>
            <p>Sign in with your credentials to continue</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                Email address
              </label>
              <div className="input-with-icon">
                <Mail size={18} className="input-icon" />
                <input
                  id="email"
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">
                Password
              </label>
              <div className="input-with-icon">
                <Lock size={18} className="input-icon" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block login-submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <p className="login-footer">&copy; {new Date().getFullYear()} Medianet. All rights reserved.</p>
      </div>
    </div>
  );
}
