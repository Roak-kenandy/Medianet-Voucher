import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import SessionWarning from './components/SessionWarning';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import OperatorsPage from './pages/admin/OperatorsPage';
import AdminsPage from './pages/admin/AdminsPage';
import ReportsPage from './pages/admin/ReportsPage';
import HelpCenterPage from './pages/shared/HelpCenterPage';
import SettingsPage from './pages/shared/SettingsPage';
import OperatorDashboard from './pages/operator/OperatorDashboard';
import CreateAccountPage from './pages/operator/CreateAccountPage';
import BulkUploadPage from './pages/operator/BulkUploadPage';
import AccountsPage from './pages/operator/AccountsPage';
import OperatorReportsPage from './pages/operator/OperatorReportsPage';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <SessionWarning />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/operators" element={<ProtectedRoute allowedRoles={['admin']}><OperatorsPage /></ProtectedRoute>} />
          <Route path="/admin/admins" element={<ProtectedRoute allowedRoles={['admin']}><AdminsPage /></ProtectedRoute>} />
          <Route path="/admin/reports" element={<ProtectedRoute allowedRoles={['admin']}><ReportsPage /></ProtectedRoute>} />
          <Route path="/admin/help" element={<ProtectedRoute allowedRoles={['admin']}><HelpCenterPage /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute allowedRoles={['admin']}><SettingsPage /></ProtectedRoute>} />
          <Route path="/admin/users" element={<Navigate to="/admin/operators" replace />} />

          <Route path="/operator" element={<ProtectedRoute allowedRoles={['operator']}><OperatorDashboard /></ProtectedRoute>} />
          <Route path="/operator/create" element={<ProtectedRoute allowedRoles={['operator']}><CreateAccountPage /></ProtectedRoute>} />
          <Route path="/operator/bulk" element={<ProtectedRoute allowedRoles={['operator']}><BulkUploadPage /></ProtectedRoute>} />
          <Route path="/operator/accounts" element={<ProtectedRoute allowedRoles={['operator']}><AccountsPage /></ProtectedRoute>} />
          <Route path="/operator/reports" element={<ProtectedRoute allowedRoles={['operator']}><OperatorReportsPage /></ProtectedRoute>} />
          <Route path="/operator/help" element={<ProtectedRoute allowedRoles={['operator']}><HelpCenterPage /></ProtectedRoute>} />
          <Route path="/operator/settings" element={<ProtectedRoute allowedRoles={['operator']}><SettingsPage /></ProtectedRoute>} />

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
