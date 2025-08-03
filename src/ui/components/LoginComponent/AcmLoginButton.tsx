import { useMsal } from "@azure/msal-react";
import { Button, ButtonProps } from "@mantine/core";
import { InteractionStatus } from "@azure/msal-browser";
import { useAuth } from "../AuthContext/index.js";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle } from "@tabler/icons-react";

function clearAllDomainCookies() {
  const cookies = document.cookie.split(";");

  for (const cookie of cookies) {
    const eqPos = cookie.indexOf("=");
    const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
    // Setting a cookie's expiration to the past deletes it.
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
}

export function AcmLoginButton(
  props: ButtonProps &
    React.ComponentPropsWithoutRef<"button"> & { returnTo: string },
) {
  const { loginMsal } = useAuth();
  const { inProgress } = useMsal();

  const handleLogin = async () => {
    if (inProgress !== InteractionStatus.None) {
      clearAllDomainCookies();
    }

    try {
      await loginMsal(props.returnTo);
    } catch (error) {
      notifications.show({
        title: "Login failed",
        message: "Please clear your cookies and try again.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      console.error("An unexpected error occurred during login:", error);
    }
  };

  return (
    <Button
      leftSection={null}
      color="#FF5F05"
      variant="filled"
      {...{ ...props, returnTo: undefined }}
      onClick={handleLogin}
    />
  );
}
