import React, { useState, useEffect, useMemo } from "react";
import {
  Avatar,
  Badge,
  Group,
  Text,
  Button,
  TextInput,
  Modal,
  Skeleton,
  Pagination,
  Select,
  Stack,
} from "@mantine/core";
import {
  IconUserPlus,
  IconTrash,
  IconSearch,
  IconAlertCircle,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { GroupMemberGetResponse, EntraActionResponse } from "@common/types/iam";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";

interface GroupMemberManagementProps {
  fetchMembers: () => Promise<GroupMemberGetResponse>;
  updateMembers: (
    toAdd: string[],
    toRemove: string[],
  ) => Promise<EntraActionResponse>;
}

interface DisplayMember {
  name: string;
  email: string;
  isNew: boolean;
  isQueuedForRemoval: boolean;
}

const PER_PAGE_OPTIONS = ["10", "20", "50", "100"].sort();

const GroupMemberManagement: React.FC<GroupMemberManagementProps> = ({
  fetchMembers,
  updateMembers,
}) => {
  const [members, setMembers] = useState<GroupMemberGetResponse>([]);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<string[]>([]);
  const [emailToAdd, setEmailToAdd] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [confirmationModal, setConfirmationModal] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [activePage, setActivePage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<string>(PER_PAGE_OPTIONS[0]);

  const loadMembers = async () => {
    try {
      setIsLoading(true);
      setMembers([]);
      const memberList = await fetchMembers();
      setMembers(memberList);
    } catch (error) {
      notifications.show({
        title: "Error",
        message: "Failed to retrieve members.",
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [fetchMembers]);

  useEffect(() => {
    setActivePage(1);
  }, [searchQuery, itemsPerPage]);

  const handleAddMember = () => {
    if (
      emailToAdd &&
      !members.some((member) => member.email === emailToAdd) &&
      !toAdd.includes(emailToAdd)
    ) {
      setToAdd((prev) => [...prev, emailToAdd]);
      setEmailToAdd("");
    } else {
      notifications.show({
        title: "Invalid Input",
        message: "Email is missing or the user already exists.",
        color: "orange",
      });
    }
  };

  const handleUndoRemoveMember = (email: string) => {
    setToRemove((prev) => prev.filter((x) => x !== email));
  };

  const handleRemoveMember = (email: string) => {
    if (!toRemove.includes(email)) {
      setToRemove((prev) => [...prev, email]);
    }
  };

  const handleCancelAdd = (email: string) => {
    setToAdd((prev) => prev.filter((item) => item !== email));
  };

  const handleSaveChanges = async () => {
    setIsLoading(true);
    try {
      const response = await updateMembers(toAdd, toRemove);
      const { failure = [] } = response;

      await loadMembers();

      setToAdd([]);
      setToRemove([]);

      if (failure.length === 0) {
        notifications.show({
          title: "Success",
          message: "All changes processed successfully!",
          color: "green",
        });
      } else {
        failure.forEach(({ email, message }) => {
          notifications.show({
            title: `Error with ${email}`,
            message,
            color: "red",
          });
        });
      }
    } catch (error) {
      notifications.show({
        title: "Error",
        message: "Failed to save changes.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setIsLoading(false);
      setConfirmationModal(false);
    }
  };

  const { paginatedMembers, totalPages } = useMemo(() => {
    const combinedList: DisplayMember[] = [
      ...members.map((member) => ({
        ...member,
        isNew: false,
        isQueuedForRemoval: toRemove.includes(member.email),
      })),
      ...toAdd.map((email) => ({
        name: email.split("@")[0],
        email,
        isNew: true,
        isQueuedForRemoval: false,
      })),
    ];

    const filtered = combinedList.filter(
      (member) =>
        member.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.email.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const numItemsPerPage = parseInt(itemsPerPage, 10);
    const total = Math.ceil(filtered.length / numItemsPerPage);
    const paginated = filtered.slice(
      (activePage - 1) * numItemsPerPage,
      activePage * numItemsPerPage,
    );

    return { paginatedMembers: paginated, totalPages: total };
  }, [members, toAdd, toRemove, searchQuery, activePage, itemsPerPage]);

  // Define columns for members table
  const memberColumns: Column<DisplayMember>[] = [
    {
      key: "member",
      label: "Member",
      isPrimaryColumn: true,
      render: (member) => (
        <Group gap="sm">
          <Avatar
            name={member.name || member.email[0]}
            color="initials"
            size="sm"
          />
          <div>
            <Text fz="sm" fw={500}>
              {member.name}
            </Text>
            <Text fz="xs" c="dimmed">
              {member.email}
            </Text>
          </div>
        </Group>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (member) => {
        if (member.isQueuedForRemoval) {
          return (
            <Badge color="red" variant="light">
              Queued for removal
            </Badge>
          );
        }
        if (member.isNew) {
          return (
            <Badge color="blue" variant="light">
              Queued for addition
            </Badge>
          );
        }
        return (
          <Badge color="green" variant="light">
            Active
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      hideMobileLabel: true,
      render: (member) => {
        if (member.isQueuedForRemoval) {
          return (
            <Button
              color="yellow"
              variant="light"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                handleUndoRemoveMember(member.email);
              }}
              leftSection={<IconTrash size={14} />}
            >
              Cancel
            </Button>
          );
        }
        if (member.isNew) {
          return (
            <Button
              color="yellow"
              variant="light"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                handleCancelAdd(member.email);
              }}
              leftSection={<IconTrash size={14} />}
            >
              Cancel
            </Button>
          );
        }
        return (
          <Button
            color="red"
            variant="light"
            size="xs"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveMember(member.email);
            }}
            leftSection={<IconTrash size={14} />}
          >
            Remove
          </Button>
        );
      },
    },
  ];

  const skeletonRows = Array.from({ length: 5 }).map((_, index) => (
    <Skeleton key={`skeleton-${index}`} height={60} radius="sm" mb="sm" />
  ));

  return (
    <Stack gap="md">
      <Group>
        <TextInput
          label="Search"
          placeholder="Enter a name or email..."
          leftSection={<IconSearch size={16} />}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Select
          label="Items per page"
          value={itemsPerPage}
          onChange={(val) => setItemsPerPage(val || PER_PAGE_OPTIONS[0])}
          data={PER_PAGE_OPTIONS}
          style={{ width: "150px" }}
        />
      </Group>

      {isLoading ? (
        <Stack gap="sm">{skeletonRows}</Stack>
      ) : paginatedMembers.length > 0 ? (
        <ResponsiveTable
          data={paginatedMembers}
          columns={memberColumns}
          keyExtractor={(member) => member.email}
          testIdPrefix="member-row"
          cardColumns={{ base: 1, xs: 2 }}
        />
      ) : (
        <Text c="dimmed" size="sm" ta="center" py="xl">
          No members found.
        </Text>
      )}

      {totalPages > 1 && (
        <Pagination
          total={totalPages}
          value={activePage}
          onChange={setActivePage}
        />
      )}

      <TextInput
        value={emailToAdd}
        onChange={(e) => setEmailToAdd(e.currentTarget.value)}
        placeholder="Enter email to add"
        label="Add New Member"
      />

      <Button
        leftSection={<IconUserPlus size={16} />}
        onClick={handleAddMember}
        disabled={isLoading}
      >
        Add Member
      </Button>

      <Button
        fullWidth
        color="blue"
        onClick={() => setConfirmationModal(true)}
        disabled={(!toAdd.length && !toRemove.length) || isLoading}
        loading={isLoading}
        leftSection={<IconDeviceFloppy size={16} color="white" />}
      >
        Save Changes
      </Button>

      <Modal
        opened={confirmationModal}
        onClose={() => setConfirmationModal(false)}
        title="Confirm Changes"
        centered
      >
        <div>
          {toAdd.length > 0 && (
            <div>
              <Text fw={500} size="sm" mb="xs">
                Members to Add:
              </Text>
              {toAdd.map((email) => (
                <Text key={email}>{email}</Text>
              ))}
            </div>
          )}
          {toRemove.length > 0 && (
            <div>
              <Text fw={500} size="sm" mt="md" mb="xs">
                Members to Remove:
              </Text>
              {toRemove.map((email) => (
                <Text key={email}>{email}</Text>
              ))}
            </div>
          )}
          <Group justify="flex-end" mt="lg">
            <Button
              variant="default"
              onClick={() => setConfirmationModal(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveChanges}
              loading={isLoading}
              color="blue"
            >
              Confirm and Save
            </Button>
          </Group>
        </div>
      </Modal>
    </Stack>
  );
};

export default GroupMemberManagement;
