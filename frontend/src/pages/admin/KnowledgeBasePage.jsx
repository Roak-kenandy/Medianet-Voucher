import { Navigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import KnowledgeBaseTab from './KnowledgeBaseTab';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '../../constants/permissions';

export default function KnowledgeBasePage() {
  const { user } = useAuth();

  if (!hasPermission(user?.role, 'manageKnowledgeBase')) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Knowledge Base</h1>
        <p className="page-subtitle">
          Upload guidelines and manuals for operators to download from Help Center
        </p>
      </div>
      <KnowledgeBaseTab />
    </Layout>
  );
}
