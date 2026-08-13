import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Header.css';

export default function Header({ onMenuToggle, sidebarOpen = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';

  return (
    <div className="header">
      <button
        type="button"
        className="header-menu-btn"
        onClick={onMenuToggle}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      <div className="header-actions" ref={menuRef}>
        <button
          className="header-profile"
          onClick={() => setProfileOpen(!profileOpen)}
          aria-expanded={profileOpen}
          aria-haspopup="true"
        >
          <div className="header-avatar">{initials}</div>
          <ChevronDown size={16} className={`header-chevron ${profileOpen ? 'open' : ''}`} />
        </button>

        {profileOpen && (
          <div className="header-dropdown">
            <div className="header-dropdown-info">
              <p className="header-dropdown-name">{user?.name}</p>
              <p className="header-dropdown-email">{user?.email}</p>
              {user?.role === 'operator' && (
                <p className="header-dropdown-meta">{user.clientName}</p>
              )}
            </div>
            <div className="header-dropdown-divider" />
            <button className="header-dropdown-item" onClick={handleLogout}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
