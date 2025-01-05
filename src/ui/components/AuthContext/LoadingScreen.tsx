import React from 'react';
import { LoadingOverlay } from '@mantine/core';
import { useColorScheme, useLocalStorage } from '@mantine/hooks';

const FullScreenLoader = () => {
  const preferredColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: 'acm-manage-color-scheme',
    defaultValue: preferredColorScheme,
  });
  return (
    <LoadingOverlay
      visible
      loaderProps={{
        color: colorScheme === 'dark' ? '#ffffff' : '#1A1B1E',
      }}
      overlayProps={{
        color: colorScheme === 'dark' ? '#1A1B1E' : '#ffffff',
      }}
    />
  );
};

export default FullScreenLoader;
