import { useLocation } from 'react-router-dom';
import { Shield, Bell, User, Lock, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import Layout from '../../components/Layout';
import PackageBadgeOverflow from '../../components/admin/PackageBadgeOverflow';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { useAuth } from '../../context/AuthContext';
import { isStaffRole, ROLE_LABELS } from '../../constants/permissions';
import '../admin/admin-shared.css';

export default function SettingsPage() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { preference, setPreference } = useTheme();
  const role = user?.role || (pathname.startsWith('/admin') ? 'admin' : 'operator');

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <Layout sidebar={<Sidebar role={role} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Account and portal preferences</p>
      </div>

      <div className="content-grid">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><User size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Account</h3>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <span className="settings-label">Name</span>
              <span>{user?.name}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Email</span>
              <span>{user?.email}</span>
            </div>
            {isStaffRole(role) && (
              <div className="settings-row">
                <span className="settings-label">Role</span>
                <span className="badge badge-info">{ROLE_LABELS[role] || role}</span>
              </div>
            )}
            {role === 'operator' && (
              <>
                <div className="settings-row">
                  <span className="settings-label">Client</span>
                  <span>{user?.clientName}</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Packages</span>
                  <PackageBadgeOverflow
                    names={user?.packageNames?.length ? user.packageNames : [user?.packageType].filter(Boolean)}
                    modalTitle="Your packages"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Lock size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Security</h3>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <span className="settings-label">Password change</span>
              <span className="badge badge-neutral">Planned</span>
            </div>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 12 }}>
              Self-service password change is not available yet. Contact your administrator to reset credentials.
            </p>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              <Shield size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Sessions expire after 15 minutes of inactivity. You will receive a warning before expiry.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Sun size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Appearance</h3>
          </div>
          <div className="card-body">
            <p className="form-hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Choose how the portal looks on this device.
            </p>
            <div className="theme-preference" role="radiogroup" aria-label="Theme preference">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={preference === value}
                  className={`theme-preference-option${preference === value ? ' active' : ''}`}
                  onClick={() => setPreference(value)}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Bell size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Notifications</h3>
          </div>
          <div className="card-body">
            <div className="settings-row">
              <span className="settings-label">Quota email alerts</span>
              <span className="badge badge-neutral">Planned</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">In-portal quota warning</span>
              <span className="badge badge-success">Active at 90%</span>
            </div>
            <p className="form-hint" style={{ marginTop: 12 }}>
              Email notifications are not yet available. Quota usage is visible on your dashboard progress bar.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
