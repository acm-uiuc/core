import { useAuth } from '@ui/components/AuthContext';
import { LoginComponent } from '@ui/components/LoginComponent';
import { HeaderNavbar } from '@ui/components/Navbar';
import { Center, Alert } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function LoginPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const [searchParams] = useSearchParams();
  const showLogoutMessage = searchParams.get('lc') === 'true';
  const showLoginMessage = !showLogoutMessage && searchParams.get('li') === 'true';

  useEffect(() => {
    if (isLoggedIn) {
      const returnTo = searchParams.get('returnTo');
      navigate(returnTo || '/home');
    }
  }, [navigate, isLoggedIn, searchParams]);

  return (
    <div style={{ display: 'flex', flexFlow: 'column', height: '100vh' }}>
      <HeaderNavbar />
      {showLogoutMessage && (
        <Alert icon={<IconAlertCircle />} title="Logged Out" color="blue">
          You have successfully logged out.
        </Alert>
      )}
      {showLoginMessage && (
        <Alert icon={<IconAlertTriangle />} title="Authentication Required" color="orange">
          You must log in to view this page.
        </Alert>
      )}
      <Center style={{ flexGrow: 1 }}>
        <LoginComponent />
      </Center>
    </div>
  );
}
