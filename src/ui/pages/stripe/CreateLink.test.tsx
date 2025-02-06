import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import StripeCreateLinkPanel from './CreateLink';
import { MemoryRouter } from 'react-router-dom';

describe('StripeCreateLinkPanel Tests', () => {
  const createLinkMock = vi.fn();

  const renderComponent = async (isLoading = false) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider withGlobalClasses withCssVariables forceColorScheme="light">
            <StripeCreateLinkPanel createLink={createLinkMock} isLoading={isLoading} />
          </MantineProvider>
        </MemoryRouter>
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form fields correctly', async () => {
    await renderComponent();

    expect(screen.getByText('Invoice ID')).toBeInTheDocument();
    expect(screen.getByText('Invoice Amount')).toBeInTheDocument();
    expect(screen.getByText('Invoice Recipient Name')).toBeInTheDocument();
    expect(screen.getByText('Invoice Recipient Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Link' })).toBeInTheDocument();
  });

  it('validates required fields before submission', async () => {
    const user = userEvent.setup();
    await renderComponent();
    await user.click(screen.getByRole('button', { name: 'Create Link' }));
    expect(createLinkMock).toHaveBeenCalledTimes(0);
    await user.type(screen.getByPlaceholderText('email@illinois.edu'), 'invalidEmail');
    await user.clear(screen.getByPlaceholderText('ACM100'));
    expect(createLinkMock).toHaveBeenCalledTimes(0);
  });

  it('calls createLink on valid form submission', async () => {
    createLinkMock.mockResolvedValue({ link: 'https://test-link.com' });
    const user = userEvent.setup();
    await renderComponent();

    await user.type(screen.getByPlaceholderText('ACM100'), 'INV123');
    await user.clear(screen.getByPlaceholderText('100'));
    await user.type(screen.getByPlaceholderText('100'), '100');
    await user.type(screen.getByPlaceholderText('John Doe'), 'John Doe');
    await user.type(screen.getByPlaceholderText('email@illinois.edu'), 'johndoe@example.com');
    await user.click(screen.getByRole('button', { name: 'Create Link' }));

    await act(async () => {
      expect(createLinkMock).toHaveBeenCalledWith({
        invoiceId: 'INV123',
        invoiceAmountUsd: 100,
        contactName: 'John Doe',
        contactEmail: 'johndoe@example.com',
      });
    });
  });

  it('displays success modal with returned link', async () => {
    createLinkMock.mockResolvedValue({ link: 'https://test-link.com' });
    const user = userEvent.setup();
    await renderComponent();

    await user.type(screen.getByPlaceholderText('ACM100'), 'INV123');
    await user.type(screen.getByPlaceholderText('100'), '100');
    await user.type(screen.getByPlaceholderText('John Doe'), 'John Doe');
    await user.type(screen.getByPlaceholderText('email@illinois.edu'), 'johndoe@example.com');
    await user.click(screen.getByRole('button', { name: 'Create Link' }));

    expect(await screen.findByText('Payment Link Created!')).toBeInTheDocument();
    expect(screen.getByText('https://test-link.com')).toBeInTheDocument();
  });

  it('handles API failure gracefully', async () => {
    const notificationsMock = vi.spyOn(notifications, 'show');
    createLinkMock.mockRejectedValue(new Error('API Error'));
    const user = userEvent.setup();
    await renderComponent();

    await user.type(screen.getByPlaceholderText('ACM100'), 'INV123');
    await user.type(screen.getByPlaceholderText('100'), '100');
    await user.type(screen.getByPlaceholderText('John Doe'), 'John Doe');
    await user.type(screen.getByPlaceholderText('email@illinois.edu'), 'johndoe@example.com');
    await user.click(screen.getByRole('button', { name: 'Create Link' }));

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        message: 'Failed to create payment link. Please try again or contact support.',
        color: 'red',
      })
    );

    notificationsMock.mockRestore();
  });
});
