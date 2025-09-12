import React, { useState, useEffect, useMemo } from "react";
import {
  Avatar,
  Badge,
  Group,
  Table,
  Text,
  Button,
  TextInput,
  Modal,
  Skeleton,
  Pagination,
  Select,
} from "@mantine/core";
import {
  IconUserPlus,
  IconTrash,
  IconSearch,
  IconAlertCircle,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { GroupMemberGetResponse, EntraActionResponse } from "@common/types/iam";

interface GroupMemberManagementProps {
  fetchMembers: () => Promise<GroupMemberGetResponse>;
  updateMembers: (
    toAdd: string[],
    toRemove: string[],
  ) => Promise<EntraActionResponse>;
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
    const combinedList = [
      ...members.map((member) => ({ ...member, isNew: false })),
      ...toAdd.map((email) => ({
        name: email.split("@")[0],
        email,
        isNew: true,
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
  }, [members, toAdd, searchQuery, activePage, itemsPerPage]);

  const rows = paginatedMembers.map((member) => {
    if (member.isNew) {
      return (
        <Table.Tr key={member.email}>
          <Table.Td>
            <Group gap="sm">
              <Avatar name={member.name} color="initials" />
              <div>
                <Text fz="sm" fw={500}>
                  {member.name}
                </Text>
                <Text fz="xs" c="dimmed">
                  {member.email}
                </Text>
              </div>
            </Group>
          </Table.Td>
          <Table.Td>
            <Badge color="blue" variant="light">
              Queued for addition
            </Badge>
          </Table.Td>
          <Table.Td>
            <Button
              color="yellow"
              variant="light"
              size="xs"
              onClick={() =>
                setToAdd((prev) => prev.filter((item) => item !== member.email))
              }
              leftSection={<IconTrash size={14} />}
            >
              Cancel
            </Button>
          </Table.Td>
        </Table.Tr>
      );
    }

    return (
      <Table.Tr key={member.email}>
        <Table.Td>
          <Group gap="sm">
            <Avatar name={member.name || member.email[0]} color="initials" />
            <div>
              <Text fz="sm" fw={500}>
                {member.name}
              </Text>
              <Text fz="xs" c="dimmed">
                {member.email}
              </Text>
            </div>
          </Group>
        </Table.Td>
        <Table.Td>
          {toRemove.includes(member.email) ? (
            <Badge color="red" variant="light">
              Queued for removal
            </Badge>
          ) : (
            <Badge color="green" variant="light">
              Active
            </Badge>
          )}
        </Table.Td>
        <Table.Td>
          {toRemove.includes(member.email) ? (
            <Button
              color="yellow"
              variant="light"
              size="xs"
              onClick={() => handleUndoRemoveMember(member.email)}
              leftSection={<IconTrash size={14} />}
            >
              Cancel
            </Button>
          ) : (
            <Button
              color="red"
              variant="light"
              size="xs"
              onClick={() => handleRemoveMember(member.email)}
              leftSection={<IconTrash size={14} />}
            >
              Remove
            </Button>
          )}
        </Table.Td>
      </Table.Tr>
    );
  });

  const skeletonRows = Array.from({ length: 5 }).map((_, index) => (
    <Table.Tr key={`skeleton-${index}`}>
      <Table.Td colSpan={3}>
        <Skeleton height={40} radius="sm" />
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <div>
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
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Member</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading ? (
            skeletonRows
          ) : rows.length > 0 ? (
            rows
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text c="dimmed" size="sm">
                  No members found.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {totalPages > 1 && (
        <Pagination
          total={totalPages}
          value={activePage}
          onChange={setActivePage}
          mt="md"
        />
      )}
      <TextInput
        value={emailToAdd}
        onChange={(e) => setEmailToAdd(e.currentTarget.value)}
        placeholder="Enter email to add"
        label="Add New Member"
      />
      <Button
        mt="sm"
        leftSection={<IconUserPlus size={16} />}
        onClick={handleAddMember}
        disabled={isLoading}
      >
        Add Member
      </Button>

      <Button
        fullWidth
        color="blue"
        mt="xl"
        onClick={() => setConfirmationModal(true)}
        disabled={(!toAdd.length && !toRemove.length) || isLoading}
        loading={isLoading}
      >
        Save Changes
      </Button>

      <Modal
        opened={confirmationModal}
        onClose={() => setConfirmationModal(false)}
        title="Confirm Changes"
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
    </div>
  );
};

export default GroupMemberManagement;
