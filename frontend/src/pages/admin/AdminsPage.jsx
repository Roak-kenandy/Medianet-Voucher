import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import AdminsTab from './AdminsTab';
import { useAuth } from '../../context/AuthContext';

export default function AdminsPage() {
  const { user } = useAuth();

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Staff</h1>
        <p className="page-subtitle">Manage admin portal accounts and roles</p>
      </div>
      <AdminsTab />
    </Layout>
  );
}
