import { createContext } from 'react';

type ColorSchemeContextType = {
  colorScheme: string;
  onChange: CallableFunction;
} | null;

export default createContext<ColorSchemeContextType>(null);
