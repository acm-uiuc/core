import React from 'react';
import { Link } from 'react-router-dom';

import brandImgUrl from '@ui/banner-blue.png';
import brandWhiteImgUrl from '@ui/banner-white.png';
import { useMantineTheme } from '@mantine/core';
import { useColorScheme, useLocalStorage } from '@mantine/hooks';

interface LogoBadgeProps {
  size?: string;
  linkTo?: string;
  showText?: boolean;
}

export const LogoBadge: React.FC<LogoBadgeProps> = ({ size, linkTo, showText }) => {
  const isNonProd = import.meta.env.VITE_RUN_ENVIRONMENT !== 'prod';
  if (!showText) {
    showText = true;
  }
  if (!size) {
    size = '1em';
  }
  const preferredColorScheme = useColorScheme();
  const [colorScheme, setColorScheme] = useLocalStorage({
    key: 'acm-manage-color-scheme',
    defaultValue: preferredColorScheme,
  });
  const runEnv = import.meta.env.VITE_RUN_ENVIRONMENT;
  return (
    <b>
      <Link
        to={linkTo || '/'}
        style={{
          fontSize: size,
          textDecoration: 'none',
          color: isNonProd ? 'red' : colorScheme === 'dark' ? '#F2FDFF' : '#0053B3',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <img
          src={colorScheme === 'dark' ? brandWhiteImgUrl : brandImgUrl}
          alt="ACM Logo"
          style={{ height: '3em', marginRight: '0.5em' }}
        />
        {showText
          ? isNonProd && runEnv
            ? `Management Portal ${runEnv.toUpperCase().replace('LOCAL-DEV', 'DEV')} ENV`
            : 'Management Portal'
          : null}
      </Link>
    </b>
  );
};

export default LogoBadge;
