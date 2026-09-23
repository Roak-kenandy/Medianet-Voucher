import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getHomePathForRole, getHomePathForUser } from '../constants/permissions';
import {
  operatorHasPermission,
  permissionForOperatorPath,
} from '../constants/operatorPermissions';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={getHomePathForUser(user)} replace />;
  }

  if (user.role === 'operator') {
    const requiredPermission = permissionForOperatorPath(location.pathname);
    if (requiredPermission && !operatorHasPermission(user, requiredPermission)) {
      return <Navigate to={getHomePathForUser(user)} replace />;
    }
  }

  return children;
}
