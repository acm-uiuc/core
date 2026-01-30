import React from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLocation,
} from "react-router-dom";
import { useAuth } from "./components/AuthContext";
import AuthCallback from "./components/AuthContext/AuthCallbackHandler.page";
import { Error404Page } from "./pages/Error404.page";
import { ErrorPage } from "./pages/Error.page";
import { HomePage } from "./pages/Home.page";
import { LoginPage } from "./pages/Login.page";
import { LogoutPage } from "./pages/Logout.page";
import { ManageEventPage } from "./pages/events/ManageEvent.page";
import { ViewEventsPage } from "./pages/events/ViewEvents.page";
import { LinkShortener } from "./pages/linkry/LinkShortener.page";
import { ManageLinkPage } from "./pages/linkry/ManageLink.page";
import { FulfillStorePurchasesPage } from "./pages/store/FulfillStorePurchases.page";
import { ManageIamPage } from "./pages/iam/ManageIam.page";
import { ViewProfilePage } from "./pages/profile/ViewProfile.page";
import { ManageStripeLinksPage } from "./pages/stripe/ViewLinks.page";
import { ManageRoomRequestsPage } from "./pages/roomRequest/RoomRequestLanding.page";
import { ViewRoomRequest } from "./pages/roomRequest/ViewRoomRequest.page";
import { ViewLogsPage } from "./pages/logs/ViewLogs.page";
import { TermsOfService } from "./pages/tos/TermsOfService.page";
import { ManageApiKeysPage } from "./pages/apiKeys/ManageKeys.page";
import { ManageExternalMembershipPage } from "./pages/membershipLists/MembershipListsPage";
import { OrgInfoPage } from "./pages/organization/OrgInfo.page";
import { ViewStoreItemsPage } from "./pages/store/ViewStoreItems.page";
import { ViewRsvpConfigsPage } from "./pages/rsvps/ViewRsvpConfigs.page";
import { ManageRsvpConfigFormPage } from "./pages/rsvps/ManageRsvpConfig.page";

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
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
      ...commonRoutes,
      {
        path: "/profile",
        element: <ViewProfilePage />,
      },
      {
        path: "*",
        element: <ProfileRediect />,
      },
    ],
  },
]);

const unauthenticatedRouter = createBrowserRouter([
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
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
    ],
  },
]);

const authenticatedRouter = createBrowserRouter([
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
      ...commonRoutes,
      {
        path: "/",
        element: <Navigate to="/home" replace />,
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
        element: <ViewProfilePage />,
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
        path: "/rsvps/manage",
        element: <ViewRsvpConfigsPage />,
      },
      {
        path: "/rsvps/manage/:eventId",
        element: <ManageRsvpConfigFormPage />,
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
        path: "/store",
        element: <ViewStoreItemsPage />,
      },
      // {
      //   path: "/store/fulfill",
      //   element: <FulfillStorePurchasesPage />,
      // },
      {
        path: "/iam",
        element: <ManageIamPage />,
      },
      {
        path: "/membershipLists",
        element: <ManageExternalMembershipPage />,
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
      {
        path: "/orgInfo",
        element: <OrgInfoPage />,
      },
      // Catch-all route for authenticated users shows 404 page
      {
        path: "*",
        element: <Error404Page />,
      },
    ],
  },
]);

export const Router: React.FC = () => {
  const { isLoggedIn } = useAuth();
  const router = isLoggedIn
    ? authenticatedRouter
    : isLoggedIn === null
      ? profileRouter
      : unauthenticatedRouter;

  return <RouterProvider router={router} />;
};
