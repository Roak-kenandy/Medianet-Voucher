import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import MarketingAdsTab from './MarketingAdsTab';
import { useAuth } from '../../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { hasPermission } from '../../constants/permissions';

export default function MarketingAdsPage() {
  const { user } = useAuth();

  if (!hasPermission(user?.role, 'manageMarketingAds')) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'admin'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Marketing Ads</h1>
        <p className="page-subtitle">
          Promotional banners for operator dashboards — schedule start and end dates for each campaign
        </p>
      </div>
      <MarketingAdsTab />
    </Layout>
  );
}
