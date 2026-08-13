import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Shield,
  FileBarChart,
  UserPlus,
  Upload,
  List,
  HelpCircle,
  Settings,
} from 'lucide-react';
import Logo from './Logo';
import './Sidebar.css';

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/operators', label: 'Operators', icon: Users },
  { to: '/admin/admins', label: 'Admins', icon: Shield },
  { to: '/admin/reports', label: 'Reports', icon: FileBarChart },
];

const operatorNav = [
  { to: '/operator', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/operator/create', label: 'Create Account', icon: UserPlus },
  { to: '/operator/bulk', label: 'Bulk Upload', icon: Upload },
  { to: '/operator/accounts', label: 'Accounts', icon: List },
  { to: '/operator/reports', label: 'Reports', icon: FileBarChart },
];

const footerNav = (role) => [
  { to: role === 'admin' ? '/admin/help' : '/operator/help', label: 'Help Center', icon: HelpCircle },
  { to: role === 'admin' ? '/admin/settings' : '/operator/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ role, onNavigate }) {
  const navItems = role === 'admin' ? adminNav : operatorNav;

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <Logo size={32} framed className="sidebar-logo-img" />
        <span className="sidebar-brand-text">Medianet</span>
      </div>

      <div className="sidebar-section">
        <ul className="sidebar-nav">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => onNavigate?.()}
              >
                <Icon size={18} strokeWidth={1.75} />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-divider" />
        <ul className="sidebar-nav">
          {footerNav(role).map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => onNavigate?.()}
              >
                <Icon size={18} strokeWidth={1.75} />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
