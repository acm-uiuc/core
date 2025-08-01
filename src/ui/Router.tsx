import React, { useState, useEffect, ReactNode } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { AcmAppShell } from "./components/AppShell";
import { useAuth } from "./components/AuthContext";
import AuthCallback from "./components/AuthContext/AuthCallbackHandler.page";
import { Error404Page } from "./pages/Error404.page";
import { Error500Page } from "./pages/Error500.page";
import { HomePage } from "./pages/Home.page";
import { LoginPage } from "./pages/Login.page";
import { LogoutPage } from "./pages/Logout.page";
import { ManageEventPage } from "./pages/events/ManageEvent.page";
import { ViewEventsPage } from "./pages/events/ViewEvents.page";
import { LinkShortener } from "./pages/linkry/LinkShortener.page";
import { ManageLinkPage } from "./pages/linkry/ManageLink.page";
import { ScanTicketsPage } from "./pages/tickets/ScanTickets.page";
import { SelectTicketsPage } from "./pages/tickets/SelectEventId.page";
import { ViewTicketsPage } from "./pages/tickets/ViewTickets.page";
import { ManageIamPage } from "./pages/iam/ManageIam.page";
import { ManageProfilePage } from "./pages/profile/ManageProfile.page";
import { ManageStripeLinksPage } from "./pages/stripe/ViewLinks.page";
import { ManageRoomRequestsPage } from "./pages/roomRequest/RoomRequestLanding.page";
import { ViewRoomRequest } from "./pages/roomRequest/ViewRoomRequest.page";
import { ViewLogsPage } from "./pages/logs/ViewLogs.page";
import { TermsOfService } from "./pages/tos/TermsOfService.page";
import { ManageApiKeysPage } from "./pages/apiKeys/ManageKeys.page";
import { ManageExternalMembershipPage } from "./pages/externalMembership/ManageExternalMembership.page";

const ProfileRediect: React.FC = () => {
  const location = useLocation();

  // Don't store login-related paths and ALLOW the callback path
  const excludedPaths = [
    "/login",
    "/logout",
    "/force_login",
    "/a",
    "/auth/callback", // Add this to excluded paths
  ];

  if (excludedPaths.includes(location.pathname)) {
    return <Navigate to="/login" replace />;
  }

  // Include search params and hash in the return URL if they exist
  const returnPath = location.pathname + location.search + location.hash;
  const loginUrl = `/profile?returnTo=${encodeURIComponent(returnPath)}&firstTime=true`;
  return <Navigate to={loginUrl} replace />;
};

// Component to handle redirects to login with return path
const LoginRedirect: React.FC = () => {
  const location = useLocation();

  // Don't store login-related paths and ALLOW the callback path
  const excludedPaths = [
    "/login",
    "/logout",
    "/force_login",
    "/a",
    "/auth/callback", // Add this to excluded paths
  ];

  if (excludedPaths.includes(location.pathname)) {
    return <Navigate to="/login" replace />;
  }

  // Include search params and hash in the return URL if they exist
  const returnPath = location.pathname + location.search + location.hash;
  const loginUrl = `/login?returnTo=${encodeURIComponent(returnPath)}&li=true`;
  return <Navigate to={loginUrl} replace />;
};

const commonRoutes = [
  {
    path: "/force_login",
    element: <LoginPage />,
  },
  {
    path: "/logout",
    element: <LogoutPage />,
  },
  {
    path: "/auth/callback",
    element: <AuthCallback />,
  },
  {
    path: "/tos",
    element: <TermsOfService />,
  },
];

const profileRouter = createBrowserRouter([
  ...commonRoutes,
  {
    path: "/profile",
    element: <ManageProfilePage />,
  },
  {
    path: "*",
    element: <ProfileRediect />,
  },
]);

const unauthenticatedRouter = createBrowserRouter([
  ...commonRoutes,
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "*",
    element: <LoginRedirect />,
  },
]);

const authenticatedRouter = createBrowserRouter([
  ...commonRoutes,
  {
    path: "/",
    element: <AcmAppShell>{null}</AcmAppShell>,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/logout",
    element: <LogoutPage />,
  },
  {
    path: "/profile",
    element: <ManageProfilePage />,
  },
  {
    path: "/home",
    element: <HomePage />,
  },
  {
    path: "/events/add",
    element: <ManageEventPage />,
  },
  {
    path: "/events/edit/:eventId",
    element: <ManageEventPage />,
  },
  {
    path: "/events/manage",
    element: <ViewEventsPage />,
  },
  {
    path: "/linkry",
    element: <LinkShortener />,
  },
  {
    path: "/linkry/add",
    element: <ManageLinkPage />,
  },
  {
    path: "/linkry/edit/:slug",
    element: <ManageLinkPage />,
  },
  {
    path: "/tickets/scan",
    element: <ScanTicketsPage />,
  },
  {
    path: "/tickets",
    element: <SelectTicketsPage />,
  },
  {
    path: "/iam",
    element: <ManageIamPage />,
  },
  {
    path: "/externalMembership",
    element: <ManageExternalMembershipPage />,
  },
  {
    path: "/tickets/manage/:eventId",
    element: <ViewTicketsPage />,
  },
  {
    path: "/stripe",
    element: <ManageStripeLinksPage />,
  },
  {
    path: "/roomRequests",
    element: <ManageRoomRequestsPage />,
  },
  {
    path: "/roomRequests/:semesterId/:requestId",
    element: <ViewRoomRequest />,
  },
  {
    path: "/logs",
    element: <ViewLogsPage />,
  },
  {
    path: "/apiKeys",
    element: <ManageApiKeysPage />,
  },
  // Catch-all route for authenticated users shows 404 page
  {
    path: "*",
    element: <Error404Page />,
  },
]);

interface ErrorBoundaryProps {
  children: ReactNode;
}

const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { isLoggedIn } = useAuth();

  const onError = (errorObj: Error) => {
    setHasError(true);
    setError(errorObj);
  };

  useEffect(() => {
    const errorHandler = (event: ErrorEvent) => {
      onError(event.error);
    };

    window.addEventListener("error", errorHandler);
    return () => {
      window.removeEventListener("error", errorHandler);
    };
  }, []);

  if (hasError && error) {
    if (error.message === "404") {
      return isLoggedIn ? <Error404Page /> : <LoginRedirect />;
    }
    return <Error500Page />;
  }

  return <>{children}</>;
};

export const Router: React.FC = () => {
  const { isLoggedIn } = useAuth();
  const router = isLoggedIn
    ? authenticatedRouter
    : isLoggedIn === null
      ? profileRouter
      : unauthenticatedRouter;

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
};
