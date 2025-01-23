import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Text,
  Select,
  List,
  ListItem,
  ScrollArea,
  Badge,
  ActionIcon,
  Group,
  Modal,
} from '@mantine/core';
import { IconTrash, IconUserPlus, IconPlus } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { RolesGetResponse, OkResponse } from '@common/types/iam';
import FullScreenLoader from '@ui/components/AuthContext/LoadingScreen';
import { AppRoles } from '@common/roles';

interface RoleManagementProps {
  fetchGroupPermissions: (groupId: string) => Promise<RolesGetResponse>;
  fetchGroups: () => Promise<{ groupId: string; description?: string }[]>;
  setGroupPermissions: (groupId: string, roles: AppRoles[] | ['all']) => Promise<OkResponse>;
}

export const RoleManagement: React.FC<RoleManagementProps> = ({
  fetchGroupPermissions,
  fetchGroups,
  setGroupPermissions,
}) => {
  const [groups, setGroups] = useState<{ groupId: string; description?: string }[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [currentRoles, setCurrentRoles] = useState<AppRoles[] | ['all']>([]);
  const [newRole, setNewRole] = useState<AppRoles | null>(null);
  const [isAllRoles, setIsAllRoles] = useState(false); // Flag for "all roles"
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState(false);

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const groupList = await fetchGroups();
        setGroups(groupList);
      } catch (error) {
        notifications.show({
          title: 'Error',
          message: 'Failed to retrieve available groups.',
          color: 'red',
        });
      }
    };
    loadGroups();
  }, [fetchGroups]);

  useEffect(() => {
    if (!selectedGroup) return;

    const loadPermissions = async () => {
      setIsLoading(true);
      try {
        const roles = await fetchGroupPermissions(selectedGroup);
        if (roles.length === 1 && roles[0] === 'all') {
          setIsAllRoles(true);
          setCurrentRoles(['all']); // Set as pointer for "all roles"
        } else {
          setIsAllRoles(false);
          setCurrentRoles(roles);
        }
      } catch (error) {
        notifications.show({
          title: 'Error',
          message: 'Failed to load group permissions.',
          color: 'red',
        });
      } finally {
        setIsLoading(false);
      }
    };
    loadPermissions();
  }, [selectedGroup, fetchGroupPermissions]);

  const handleAddRole = () => {
    if (!isAllRoles && newRole && !(currentRoles as AppRoles[]).includes(newRole)) {
      setCurrentRoles((prev): AppRoles[] => [...(prev as AppRoles[]), newRole]);
      setNewRole(null);
    } else {
      notifications.show({
        title: 'Error',
        message: 'Role already exists or is invalid.',
        color: 'red',
      });
    }
  };

  const handleAddAllRoles = () => {
    setIsAllRoles(true);
    setCurrentRoles(['all']); // Use the pointer "all"
  };

  const handleRemoveRole = (role: AppRoles) => {
    if (isAllRoles) {
      setCurrentRoles(Object.values(AppRoles).filter((r) => r !== role));
    } else {
      setCurrentRoles((prev) => (prev as AppRoles[]).filter((r) => r !== role));
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedGroup) return;

    setIsLoading(true);
    try {
      await setGroupPermissions(selectedGroup, currentRoles);
      notifications.show({
        title: 'Success',
        message: 'Roles updated successfully!',
        color: 'green',
      });
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: 'Failed to save roles.',
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box p="md">
      <Text fw={500} mb={4}>
        Permissions Management
      </Text>

      {/* Group Selector */}
      <Select
        label="Select Group"
        placeholder="Choose a group"
        data={groups.map((group) => ({
          value: group.groupId,
          label: group.description || group.groupId,
        }))}
        value={selectedGroup}
        onChange={setSelectedGroup}
        mb="md"
      />

      {/* Roles Management */}
      <Box mb="md">
        <Text fw={500} size="sm" mb="xs">
          Roles for Selected Group
        </Text>
        {isAllRoles && (
          <Badge color="blue" size="sm" mb="xs">
            All roles dynamically applied
          </Badge>
        )}
        <ScrollArea style={{ height: 150 }}>
          {isLoading && <FullScreenLoader />}
          {!isLoading && (
            <List spacing="sm">
              {(isAllRoles ? Object.values(AppRoles) : (currentRoles as AppRoles[])).map((role) => (
                <ListItem key={role}>
                  <Group justify="space-between">
                    <Text size="sm">{role}</Text>
                    <ActionIcon color="red" variant="light" onClick={() => handleRemoveRole(role)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </ListItem>
              ))}
            </List>
          )}
        </ScrollArea>
      </Box>

      {/* Add Role */}
      {!isAllRoles && (
        <>
          <Select
            label="Add Role"
            placeholder="Choose a role to add"
            data={Object.values(AppRoles).map((role) => ({ value: role, label: role }))}
            value={newRole}
            onChange={(value) => setNewRole(value as AppRoles)}
          />
          <Button
            mt="sm"
            leftSection={<IconUserPlus size={16} />}
            onClick={handleAddRole}
            disabled={!newRole}
          >
            Add Role
          </Button>
        </>
      )}

      {/* Add All Roles */}
      {!isAllRoles && (
        <Button
          mt="sm"
          color="blue"
          leftSection={<IconPlus size={16} />}
          onClick={handleAddAllRoles}
        >
          Add All Roles
        </Button>
      )}

      {/* Save Changes Button */}
      <Button
        fullWidth
        color="blue"
        mt="md"
        onClick={() => setConfirmationModal(true)}
        disabled={!selectedGroup}
        loading={isLoading}
      >
        Save Changes
      </Button>

      {/* Confirmation Modal */}
      <Modal
        opened={confirmationModal}
        onClose={() => setConfirmationModal(false)}
        title="Confirm Changes"
      >
        <Box>
          <Text fw={500} size="sm">
            The following roles will be assigned to <code>{selectedGroup}</code>:
          </Text>
          <List spacing="sm" mt="sm">
            {isAllRoles ? (
              <ListItem key="all">All roles dynamically applied</ListItem>
            ) : (
              (currentRoles as AppRoles[]).map((role) => <ListItem key={role}>{role}</ListItem>)
            )}
          </List>
          <Group justify="center" mt="lg">
            <Button
              onClick={() => {
                handleSaveChanges();
                setConfirmationModal(false);
              }}
              loading={isLoading}
              color="blue"
            >
              Confirm and Save
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmationModal(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </Group>
        </Box>
      </Modal>
    </Box>
  );
};

export default RoleManagement;
