import { DEFAULT_TIMEZONE } from "@common/constants";
import { Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

const useTimezone = () => {
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  useEffect(() => {
    const handleFocus = () => {
      const newTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (newTimezone !== timezone) {
        setTimezone(newTimezone);
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [timezone]);

  return timezone;
};

export const NonUrbanaTimezoneAlert: React.FC = () => {
  const timezone = useTimezone();

  if (timezone === DEFAULT_TIMEZONE) {
    return null;
  }

  return (
    <Alert
      variant="light"
      color="red"
      mb="md"
      title="Timezone Alert"
      icon={<IconInfoCircle />}
    >
      All dates and times are shown in the {DEFAULT_TIMEZONE} timezone. Please
      ensure you enter them in the {DEFAULT_TIMEZONE} timezone.
    </Alert>
  );
};
