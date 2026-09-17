import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import OperatorsTab from './OperatorsTab';
import { useAuth } from '../../context/AuthContext';

export default function OperatorsPage() {
  const { user } = useAuth();

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <OperatorsTab />
    </Layout>
  );
}
