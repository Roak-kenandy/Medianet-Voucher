import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import OperatorsTab from './OperatorsTab';
import { useAuth } from '../../context/AuthContext';

export default function OperatorsPage() {
  const { user } = useAuth();

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Operators</h1>
        <p className="page-subtitle">Manage client operators, packages, and account quotas</p>
      </div>
      <OperatorsTab />
    </Layout>
  );
}
