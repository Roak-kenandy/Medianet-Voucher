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
  Package,
  Wallet,
  Receipt,
  CircleDollarSign,
  Megaphone,
  BookMarked,
} from 'lucide-react';
import { isStaffRole, hasPermission } from '../constants/permissions';
import { useAuth } from '../context/AuthContext';
import { operatorHasPermission } from '../constants/operatorPermissions';
import Logo from './Logo';
import './Sidebar.css';

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/operators', label: 'Operators', icon: Users },
  { to: '/admin/operator-topup', label: 'Operator Topup', icon: Wallet },
  { to: '/admin/packages', label: 'Packages', icon: Package },
  { to: '/admin/admins', label: 'Staff', icon: Shield },
  { to: '/admin/reports', label: 'Reports', icon: FileBarChart },
  { to: '/admin/marketing-ads', label: 'Marketing Ads', icon: Megaphone, permission: 'manageMarketingAds' },
  { to: '/admin/knowledge-base', label: 'Knowledge Base', icon: BookMarked, permission: 'manageKnowledgeBase' },
];

const operatorNav = [
  { to: '/operator', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard', end: true },
  { to: '/operator/wallet', label: 'Wallet', icon: Wallet, permission: 'wallet' },
  { to: '/operator/create', label: 'Create Account', icon: UserPlus, permission: 'createAccount' },
  { to: '/operator/customers', label: 'Topup & Subscribe', icon: CircleDollarSign, permission: 'customers' },
  { to: '/operator/bulk', label: 'Bulk Upload', icon: Upload, permission: 'bulkUpload' },
  { to: '/operator/accounts', label: 'Customer History', icon: List, permission: 'accounts' },
  { to: '/operator/transactions', label: 'Transaction Reports', icon: Receipt, permission: 'transactions' },
  { to: '/operator/reports', label: 'Account Reports', icon: FileBarChart, permission: 'reports' },
];

const footerNav = (role) => [
  {
    to: isStaffRole(role) ? '/admin/help' : '/operator/help',
    label: 'Help Center',
    icon: HelpCircle,
  },
  {
    to: isStaffRole(role) ? '/admin/settings' : '/operator/settings',
    label: 'Settings',
    icon: Settings,
  },
];

export default function Sidebar({ role, onNavigate }) {
  const { user } = useAuth();
  const navItems = isStaffRole(role)
    ? adminNav.filter((item) => !item.permission || hasPermission(user?.role, item.permission))
    : operatorNav.filter((item) => operatorHasPermission(user, item.permission));

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
