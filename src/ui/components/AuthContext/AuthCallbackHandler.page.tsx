import { useMsal } from '@azure/msal-react';
import React, { useEffect } from 'react';

import FullScreenLoader from './LoadingScreen.js';

export const AuthCallback: React.FC = () => {
  const { instance } = useMsal();
  const navigate = (path: string) => {
    window.location.href = path;
  };

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check if we have pending redirects
        const response = await instance.handleRedirectPromise();
        if (!response) {
          navigate('/');
          return;
        }
        const returnPath = response.state || '/';
        const account = response.account;
        if (account) {
          instance.setActiveAccount(account);
        }

        navigate(returnPath);
      } catch (error) {
        console.error('Failed to handle auth redirect:', error);
        navigate('/login?error=callback_failed');
      }
    };

    setTimeout(() => {
      handleCallback();
    }, 100);
  }, [instance, navigate]);

  return <FullScreenLoader />;
};

export default AuthCallback;
