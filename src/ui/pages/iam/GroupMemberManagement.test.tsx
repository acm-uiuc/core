import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import GroupMemberManagement from './GroupMemberManagement';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import userEvent from '@testing-library/user-event';

describe('Exec Group Management Panel read tests', () => {
  const renderComponent = async (
    fetchMembers: () => Promise<any[]>,
    updateMembers: () => Promise<any>
  ) => {
    await act(async () => {
      render(
        <MemoryRouter>
          <MantineProvider withGlobalClasses withCssVariables forceColorScheme={'light'}>
            <GroupMemberManagement fetchMembers={fetchMembers} updateMembers={updateMembers} />
          </MantineProvider>
        </MemoryRouter>
      );
    });
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it('renders with no members', async () => {
    const fetchMembers = async () => [];
    const updateMembers = async () => ({ success: [] });

    await renderComponent(fetchMembers, updateMembers);

    expect(screen.getByText('Current Members')).toBeInTheDocument();
    expect(screen.queryByText(/.*@illinois\.edu/)).not.toBeInTheDocument();
  });

  it('renders with a single member', async () => {
    const fetchMembers = async () => [{ name: 'Doe, John', email: 'jdoe@illinois.edu' }];
    const updateMembers = async () => ({
      success: [{ email: 'jdoe@illinois.edu' }],
    });

    await renderComponent(fetchMembers, updateMembers);
    expect(screen.getByText(/Doe, John \(jdoe@illinois\.edu\)/)).toBeInTheDocument();
  });

  it('renders with multiple members', async () => {
    const fetchMembers = async () => [
      { name: 'Doe, John', email: 'jdoe@illinois.edu' },
      { name: 'Smith, Jane', email: 'jsmith@illinois.edu' },
      { name: 'Brown, Bob', email: 'bbrown@illinois.edu' },
    ];
    const updateMembers = async () => ({
      success: [
        { email: 'jdoe@illinois.edu' },
        { email: 'jsmith@illinois.edu' },
        { email: 'bbrown@illinois.edu' },
      ],
    });

    await renderComponent(fetchMembers, updateMembers);
    expect(screen.getByText(/Doe, John \(jdoe@illinois\.edu\)/)).toBeInTheDocument();
    expect(screen.getByText(/Smith, Jane \(jsmith@illinois\.edu\)/)).toBeInTheDocument();
    expect(screen.getByText(/Brown, Bob \(bbrown@illinois\.edu\)/)).toBeInTheDocument();
  });

  it('displays all required UI elements', async () => {
    const fetchMembers = async () => [];
    const updateMembers = async () => ({ success: [] });

    await renderComponent(fetchMembers, updateMembers);

    expect(screen.getByText('Exec Council Group Management')).toBeInTheDocument();
    expect(screen.getByText('Current Members')).toBeInTheDocument();
    expect(screen.getByLabelText('Add Member')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Member' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('adds a new member and saves changes', async () => {
    const notificationsMock = vi.spyOn(notifications, 'show');
    const user = userEvent.setup();
    const fetchMembers = async () => [];
    const updateMembers = vi.fn().mockResolvedValue({
      success: [{ email: 'member@illinois.edu' }],
      failure: [],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Input the email
    const emailInput = screen.getByPlaceholderText('Enter email');
    await user.type(emailInput, 'member@illinois.edu');

    // Click Add Member button
    const addButton = screen.getByRole('button', { name: 'Add Member' });
    await user.click(addButton);

    // Verify member appears with "Queued for addition" badge
    expect(screen.getByText('member@illinois.edu')).toBeInTheDocument();
    expect(screen.getByText('Queued for addition')).toBeInTheDocument();

    // Click Save Changes which opens modal
    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    // Wait for the modal to appear with title
    await screen.findByText('Confirm Changes');

    // Find and click confirm button in modal
    const confirmButton = screen.getByRole('button', { name: 'Confirm and Save' });
    await user.click(confirmButton);

    // Verify updateMembers was called with correct parameters
    expect(updateMembers).toHaveBeenCalledWith(['member@illinois.edu'], []);

    // Verify list is updated - "Queued for addition" badge should be gone
    expect(screen.getByText(/member \(member@illinois\.edu\)/)).toBeInTheDocument();
    expect(screen.queryByText('Queued for addition')).not.toBeInTheDocument();

    // Verify notifications were shown
    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'All changes processed successfully!',
        color: 'green',
      })
    );

    // Verify Save Changes button is disabled again after successful update
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    // Clean up
    notificationsMock.mockRestore();
  });
  it('handles failed member updates correctly', async () => {
    const notificationsMock = vi.spyOn(notifications, 'show');
    const user = userEvent.setup();
    const fetchMembers = async () => [];
    const updateMembers = vi.fn().mockResolvedValue({
      success: [],
      failure: [
        {
          email: 'member@illinois.edu',
          message: 'User does not exist in directory',
        },
      ],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Add a member that will fail
    const emailInput = screen.getByPlaceholderText('Enter email');
    await user.type(emailInput, 'member@illinois.edu');
    await user.click(screen.getByRole('button', { name: 'Add Member' }));

    // Verify member shows in queue
    expect(screen.getByText('member@illinois.edu')).toBeInTheDocument();
    expect(screen.getByText('Queued for addition')).toBeInTheDocument();

    // Try to save changes
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Confirm Changes');
    await user.click(screen.getByRole('button', { name: 'Confirm and Save' }));

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error adding member@illinois.edu',
        message: 'User does not exist in directory',
        color: 'red',
      })
    );

    // Verify member is no longer shown as queued (since queues are cleared)
    expect(screen.queryByText('Queued for addition')).not.toBeInTheDocument();

    // Verify Save Changes button is disabled since queues are cleared
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    notificationsMock.mockRestore();
  });

  it('removes an existing member', async () => {
    const notificationsMock = vi.spyOn(notifications, 'show');
    const user = userEvent.setup();
    const fetchMembers = async () => [
      {
        name: 'Existing Member',
        email: 'existing@illinois.edu',
      },
    ];
    const updateMembers = vi.fn().mockResolvedValue({
      success: [{ email: 'existing@illinois.edu' }],
      failure: [],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Click remove button for the existing member using data-testid
    const removeButton = screen.getByTestId('remove-exec-member-existing@illinois.edu');
    await user.click(removeButton);

    // Verify member shows removal badge
    expect(screen.getByText('Queued for removal')).toBeInTheDocument();

    // Save changes
    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await screen.findByText('Confirm Changes');
    const confirmButton = screen.getByRole('button', { name: 'Confirm and Save' });
    await user.click(confirmButton);

    // Verify updateMembers was called with correct parameters
    expect(updateMembers).toHaveBeenCalledWith(
      [], // toAdd
      ['existing@illinois.edu'] // toRemove
    );

    // Verify member is removed from the list
    expect(
      screen.queryByText(/Existing Member \(existing@illinois\.edu\)/)
    ).not.toBeInTheDocument();

    // Verify success notification
    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'All changes processed successfully!',
        color: 'green',
      })
    );

    notificationsMock.mockRestore();
  });
  it('handles multiple member changes with mixed success/failure results', async () => {
    const notificationsMock = vi.spyOn(notifications, 'show');
    const user = userEvent.setup();

    // Start with two existing members
    const fetchMembers = async () => [
      { name: 'Stay Member', email: 'stay@illinois.edu' },
      { name: 'Remove Success', email: 'removesuccess@illinois.edu' },
      { name: 'Remove Fail', email: 'removefail@illinois.edu' },
    ];

    // Mock mixed success/failure response
    const updateMembers = vi.fn().mockResolvedValue({
      success: [
        { email: 'removesuccess@illinois.edu' }, // removal succeeded
        { email: 'addsuccess@illinois.edu' }, // addition succeeded
      ],
      failure: [
        {
          email: 'removefail@illinois.edu',
          message: 'Cannot remove admin user',
        },
        {
          email: 'addfail@illinois.edu',
          message: 'User not found in directory',
        },
      ],
    });

    await renderComponent(fetchMembers, updateMembers);

    // Add two new members - one will succeed, one will fail
    const emailInput = screen.getByPlaceholderText('Enter email');

    await user.type(emailInput, 'addsuccess@illinois.edu');
    await user.click(screen.getByRole('button', { name: 'Add Member' }));

    await user.type(emailInput, 'addfail@illinois.edu');
    await user.click(screen.getByRole('button', { name: 'Add Member' }));

    // Remove two existing members - one will succeed, one will fail
    await user.click(screen.getByTestId('remove-exec-member-removesuccess@illinois.edu'));
    await user.click(screen.getByTestId('remove-exec-member-removefail@illinois.edu'));

    // Verify queued states before save
    expect(screen.getByText('addsuccess@illinois.edu')).toBeInTheDocument();
    expect(screen.getByText('addfail@illinois.edu')).toBeInTheDocument();
    expect(screen.getAllByText('Queued for addition')).toHaveLength(2);
    expect(screen.getAllByText('Queued for removal')).toHaveLength(2);

    // Save changes
    const saveButton = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    // Confirm in modal
    await screen.findByText('Confirm Changes');
    const confirmButton = screen.getByRole('button', { name: 'Confirm and Save' });
    await user.click(confirmButton);

    // Verify updateMembers was called with all changes
    expect(updateMembers).toHaveBeenCalledWith(
      ['addsuccess@illinois.edu', 'addfail@illinois.edu'],
      ['removesuccess@illinois.edu', 'removefail@illinois.edu']
    );

    // Verify error notifications for failures
    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error adding addfail@illinois.edu',
        message: 'User not found in directory',
        color: 'red',
      })
    );

    expect(notificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error removing removefail@illinois.edu',
        message: 'Cannot remove admin user',
        color: 'red',
      })
    );

    // Verify end state of member list
    // Success cases
    expect(screen.queryByText(/removesuccess@illinois\.edu/)).not.toBeInTheDocument(); // Successfully removed
    expect(screen.getByText(/addsuccess@illinois\.edu/)).toBeInTheDocument(); // Successfully added

    // Failure cases
    expect(screen.getByText(/removefail@illinois\.edu/)).toBeInTheDocument(); // Failed to remove
    expect(screen.queryByText(/addfail@illinois\.edu/)).not.toBeInTheDocument(); // Failed to add

    // Unchanged member
    expect(screen.getByText(/stay@illinois\.edu/)).toBeInTheDocument();

    // Verify queued badges are cleared
    expect(screen.queryByText('Queued for addition')).not.toBeInTheDocument();
    expect(screen.queryByText('Queued for removal')).not.toBeInTheDocument();

    // Verify Save Changes button is disabled after operation
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    notificationsMock.mockRestore();
  });
});
