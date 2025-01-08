import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import LogoBadge from './Logo';

describe('Logo basic tests', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('renders the logo image', () => {
    render(
      <MemoryRouter>
        <LogoBadge />
      </MemoryRouter>
    );
    const logo = screen.getByAltText('ACM Logo');
    expect(logo).toBeInTheDocument();
    const logoSrc = logo.getAttribute('src');
    expect(logo).toHaveStyle('height: 3em');
    expect(logoSrc).toEqual('/banner-blue.png')
  });

  it('renders the red text "Management Portal DEV ENV" in the dev env', () => {
    render(
      <MemoryRouter>
        <LogoBadge />
      </MemoryRouter>
    );

    const text = screen.getByText('Management Portal DEV ENV');
    const style = window.getComputedStyle(text);
    expect(text).toBeInTheDocument();
    expect(style.color).toBe('rgb(255, 0, 0)'); // Red in RGB format
  });
});
