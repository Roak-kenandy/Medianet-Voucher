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
import WalletPage from './pages/operator/WalletPage';
import WalletPaymentReturnPage from './pages/operator/WalletPaymentReturnPage';
import CustomerActionsPage from './pages/operator/CustomerActionsPage';
import TransactionReportsPage from './pages/operator/TransactionReportsPage';
import PackagesPage from './pages/admin/PackagesPage';
import { STAFF_ROLES } from './constants/permissions';

const staffRoute = (element) => (
  <ProtectedRoute allowedRoles={STAFF_ROLES}>{element}</ProtectedRoute>
);

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <SessionWarning />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/admin" element={staffRoute(<AdminDashboard />)} />
          <Route path="/admin/operators" element={staffRoute(<OperatorsPage />)} />
          <Route path="/admin/packages" element={staffRoute(<PackagesPage />)} />
          <Route path="/admin/admins" element={staffRoute(<AdminsPage />)} />
          <Route path="/admin/reports" element={staffRoute(<ReportsPage />)} />
          <Route path="/admin/help" element={staffRoute(<HelpCenterPage />)} />
          <Route path="/admin/settings" element={staffRoute(<SettingsPage />)} />
          <Route path="/admin/users" element={<Navigate to="/admin/operators" replace />} />

          <Route path="/operator" element={<ProtectedRoute allowedRoles={['operator']}><OperatorDashboard /></ProtectedRoute>} />
          <Route path="/operator/create" element={<ProtectedRoute allowedRoles={['operator']}><CreateAccountPage /></ProtectedRoute>} />
          <Route path="/operator/customers" element={<ProtectedRoute allowedRoles={['operator']}><CustomerActionsPage /></ProtectedRoute>} />
          <Route path="/operator/topup" element={<Navigate to="/operator/customers?mode=topup" replace />} />
          <Route path="/operator/subscribe" element={<Navigate to="/operator/customers?mode=subscribe" replace />} />
          <Route path="/operator/customer-topup" element={<Navigate to="/operator/customers?mode=subscribe" replace />} />
          <Route path="/operator/activate" element={<Navigate to="/operator/customers?mode=subscribe" replace />} />
          <Route path="/operator/transactions" element={<ProtectedRoute allowedRoles={['operator']}><TransactionReportsPage /></ProtectedRoute>} />
          <Route path="/operator/bulk" element={<ProtectedRoute allowedRoles={['operator']}><BulkUploadPage /></ProtectedRoute>} />
          <Route path="/operator/accounts" element={<ProtectedRoute allowedRoles={['operator']}><AccountsPage /></ProtectedRoute>} />
          <Route path="/operator/wallet" element={<ProtectedRoute allowedRoles={['operator']}><WalletPage /></ProtectedRoute>} />
          <Route path="/operator/wallet/payment/return" element={<ProtectedRoute allowedRoles={['operator']}><WalletPaymentReturnPage /></ProtectedRoute>} />
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
