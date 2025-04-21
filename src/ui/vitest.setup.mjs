import "zod-openapi/extend";
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const { getComputedStyle } = window;
window.getComputedStyle = (elt) => getComputedStyle(elt);
window.HTMLElement.prototype.scrollIntoView = () => {};

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserver;

vi.mock('react-router-dom', async () => {
  const actualRouter = await vi.importActual('react-router-dom');
  return {
    ...actualRouter, // Retain all actual exports
    useNavigate: vi.fn(() => vi.fn()), // Mock `useNavigate`
  };
});

vi.mock('@mantine/hooks', async () => {
  const rrdactual = await vi.importActual('react-router-dom');
  return {
    ...rrdactual,
    useLocalStorage: vi.fn().mockReturnValue(['light', vi.fn()]),
    useColorScheme: vi.fn(() => 'light'),
    useDisclosure: vi.fn(() => {
      const state = { isOpen: false };
      const open = vi.fn(() => (state.isOpen = true));
      const close = vi.fn(() => (state.isOpen = false));
      const toggle = vi.fn(() => (state.isOpen = !state.isOpen));
      return [state.isOpen, { open, close, toggle }];
    }),
  }
});
