import { useLocation } from 'react-router-dom';
import { Shield, Bell, User, Lock } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { useAuth } from '../../context/AuthContext';
import '../admin/admin-shared.css';

export default function SettingsPage() {
  const { pathname } = useLocation();
  const role = pathname.startsWith('/admin') ? 'admin' : 'operator';
  const { user } = useAuth();

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
            {role === 'operator' && (
              <>
                <div className="settings-row">
                  <span className="settings-label">Client</span>
                  <span>{user?.clientName}</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Package</span>
                  <span className="badge badge-info">{user?.packageType || 'OTT ENTERTAINMENT (1y)'}</span>
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
