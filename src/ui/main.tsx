import { Configuration, PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { AuthProvider } from './components/AuthContext';
import '@ungap/with-resolvers';
import { getRunEnvironmentConfig } from './config';

const envConfig = getRunEnvironmentConfig();

const msalConfiguration: Configuration = {
  auth: {
    clientId: envConfig.AadValidClientId,
    authority: 'https://login.microsoftonline.com/c8d9148f-9a59-4db3-827d-42ea0c2b6e2e',
    redirectUri: `${window.location.origin}/auth/callback`,
    postLogoutRedirectUri: `${window.location.origin}/logout`,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: true,
  },
};

const pca = new PublicClientApplication(msalConfiguration);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <MsalProvider instance={pca}>
    <AuthProvider>
      <App />
    </AuthProvider>
  </MsalProvider>
);
