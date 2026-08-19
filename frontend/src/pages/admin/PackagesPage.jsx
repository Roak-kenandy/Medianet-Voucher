import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import PackagesTab from './PackagesTab';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../constants/permissions';

export default function PackagesPage() {
  const { user } = useAuth();
  const canCreatePackage = hasPermission(user?.role, 'createPackage');

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Packages</h1>
        <p className="page-subtitle">
          {canCreatePackage
            ? 'Create and manage CRM-linked packages for operator assignment'
            : 'View CRM-linked packages used for operator assignment'}
        </p>
      </div>
      <PackagesTab />
    </Layout>
  );
}
