import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import AdminsTab from './AdminsTab';

export default function AdminsPage() {
  return (
    <Layout sidebar={<Sidebar role="admin" />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Admins</h1>
        <p className="page-subtitle">Manage administrator accounts and access</p>
      </div>
      <AdminsTab />
    </Layout>
  );
}
