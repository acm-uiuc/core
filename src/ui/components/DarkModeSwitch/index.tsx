import { Switch, useMantineTheme, rem } from '@mantine/core';
import { useColorScheme, useLocalStorage } from '@mantine/hooks';
import { IconSun, IconMoonStars } from '@tabler/icons-react';

function DarkModeSwitch() {
  const theme = useMantineTheme();
  const preferredColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: 'acm-manage-color-scheme',
    defaultValue: preferredColorScheme,
  });
  const sunIcon = (
    <IconSun
      style={{ width: rem(16), height: rem(16) }}
      stroke={2.5}
      color={theme.colors.yellow[8]}
    />
  );

  const moonIcon = (
    <IconMoonStars
      style={{ width: rem(16), height: rem(16) }}
      stroke={2.5}
      color={theme.colors.blue[6]}
    />
  );

  const handleToggle = (event: any) => {
    if (event.currentTarget.checked) {
      setColorScheme('dark');
    } else {
      setColorScheme('light');
    }
  };

  return (
    <Switch
      size="md"
      color="dark.4"
      checked={colorScheme === 'dark'}
      onChange={(event) => {
        handleToggle(event);
      }}
      onLabel={moonIcon}
      offLabel={sunIcon}
    />
  );
}

export { DarkModeSwitch };
