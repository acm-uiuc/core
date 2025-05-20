import { useAuth } from "@ui/components/AuthContext";
import { LoginComponent } from "@ui/components/LoginComponent";
import { HeaderNavbar } from "@ui/components/Navbar";
import { Center, Alert } from "@mantine/core";
import { IconAlertCircle, IconAlertTriangle } from "@tabler/icons-react";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "@ui/util/api";

export function LoginPage() {
  const navigate = useNavigate();
  const graphApi = useApi("msGraphApi");
  const { isLoggedIn, setLoginStatus } = useAuth();
  const [searchParams] = useSearchParams();
  const showLogoutMessage = searchParams.get("lc") === "true";
  const showLoginMessage =
    !showLogoutMessage && searchParams.get("li") === "true";

  useEffect(() => {
    const evalState = async () => {
      if (isLoggedIn) {
        const returnTo = searchParams.get("returnTo");
        const me = (await graphApi.get("/v1.0/me?$select=givenName,surname"))
          .data as {
          givenName?: string;
          surname?: string;
        };
        if (!me.givenName || !me.surname) {
          setLoginStatus(null);
          navigate(
            `/profile?firstTime=true${returnTo ? `&returnTo=${returnTo}` : ""}`,
          );
        } else {
          navigate(returnTo || "/home");
        }
      }
    };
    evalState();
  }, [navigate, isLoggedIn, searchParams]);

  return (
    <div style={{ display: "flex", flexFlow: "column", height: "100vh" }}>
      <HeaderNavbar />
      {showLogoutMessage && (
        <Alert icon={<IconAlertCircle />} title="Logged Out" color="blue">
          You have successfully logged out.
        </Alert>
      )}
      {showLoginMessage && (
        <Alert
          icon={<IconAlertTriangle />}
          title="Authentication Required"
          color="orange"
        >
          You must log in to view this page.
        </Alert>
      )}
      <Center style={{ flexGrow: 1 }}>
        <LoginComponent />
      </Center>
    </div>
  );
}
