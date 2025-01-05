import { Navigate } from 'react-router-dom';

import { useAuth } from '@ui/components/AuthContext';

export function LogoutPage() {
  const { logoutCallback } = useAuth();
  logoutCallback();
  return <Navigate to={`/login?lc=true`} />;
}
