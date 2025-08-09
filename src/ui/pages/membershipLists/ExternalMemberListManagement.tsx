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
  Box,
  Textarea,
  Accordion,
  ScrollArea,
  Stack,
} from "@mantine/core";
import { IconUserPlus, IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { illinoisNetId } from "@common/types/generic";
import { AuthGuard } from "@ui/components/AuthGuard";
import { AppRoles } from "@common/roles";
import pluralize from "pluralize";

interface ExternalMemberListManagementProps {
  fetchMembers: (listId: string) => Promise<string[]>;
  updateMembers: (
    listId: string,
    add: string[],
    remove: string[],
  ) => Promise<void>;
  validLists: string[];
  onListCreated: (listId: string) => void;
}

const ITEMS_PER_PAGE = 10;
const CHANGE_DISPLAY_LIMIT = 10;

const ExternalMemberListManagement: React.FC<
  ExternalMemberListManagementProps
> = ({ fetchMembers, updateMembers, validLists, onListCreated }) => {
  const [members, setMembers] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listId, setListId] = useState<string | null>(validLists[0] || null);
  const [activePage, setPage] = useState(1);
  const [confirmationModalOpened, setConfirmationModalOpened] = useState(false);

  // State for modals
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [replaceModalOpened, setReplaceModalOpened] = useState(false);

  // State for forms
  const [newListId, setNewListId] = useState("");
  const [initialMemberNetId, setInitialMemberNetId] = useState("");
  const [newMemberNetId, setNewMemberNetId] = useState("");
  const [replacementList, setReplacementList] = useState("");

  // State for API calls and pending changes
  const [isCreating, setIsCreating] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<string[]>([]);

  const loadMembers = async () => {
    if (!listId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setMembers([]);
      setToAdd([]);
      setToRemove([]);
      setPage(1);
      const memberList = await fetchMembers(listId);
      setMembers(memberList);
    } catch (error) {
      notifications.show({
        title: "Failed to load members",
        message: "There was an error fetching the member list.",
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, [listId]);

  const allDisplayMembers = useMemo(() => {
    const uniquePending = toAdd.filter((p) => !members.includes(p));
    return [...members, ...uniquePending];
  }, [members, toAdd]);

  const paginatedData = useMemo(() => {
    const startIndex = (activePage - 1) * ITEMS_PER_PAGE;
    return allDisplayMembers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [allDisplayMembers, activePage]);

  const totalPages = Math.ceil(allDisplayMembers.length / ITEMS_PER_PAGE);

  const handleAddMember = () => {
    const validationResult = illinoisNetId.safeParse(newMemberNetId);
    if (!validationResult.success) {
      notifications.show({
        title: "Invalid NetID",
        message: "Please enter a valid NetID.",
        color: "orange",
      });
      return;
    }
    if (allDisplayMembers.includes(newMemberNetId)) {
      notifications.show({
        title: "User Exists",
        message: "This user is already in the list or queued for addition.",
        color: "orange",
      });
    } else {
      setToAdd((prev) => [...prev, newMemberNetId]);
      setNewMemberNetId("");
    }
  };

  const handleQueueRemove = (netId: string) => {
    if (!toRemove.includes(netId)) {
      setToRemove((prev) => [...prev, netId]);
    }
  };
  const handleCancelRemove = (netId: string) =>
    setToRemove((prev) => prev.filter((id) => id !== netId));
  const handleCancelAdd = (netId: string) =>
    setToAdd((prev) => prev.filter((id) => id !== netId));

  const handleSaveChanges = async () => {
    if (!listId) {
      return;
    }
    setIsLoading(true);
    try {
      await updateMembers(listId, toAdd, toRemove);
      notifications.show({
        title: "Success",
        message: "Member list has been updated.",
        color: "green",
      });
      await loadMembers();
    } finally {
      setIsLoading(false);
      setConfirmationModalOpened(false);
    }
  };

  const handleCreateWithInitialMember = async () => {
    if (!newListId.trim()) {
      notifications.show({
        title: "Invalid Input",
        message: "List ID cannot be empty.",
        color: "orange",
      });
      return;
    }
    const validationResult = illinoisNetId.safeParse(initialMemberNetId);
    if (!validationResult.success) {
      notifications.show({
        title: "Invalid NetID",
        message: "Please enter a valid NetID for the initial member.",
        color: "orange",
      });
      return;
    }
    setIsCreating(true);
    try {
      await updateMembers(newListId, [initialMemberNetId], []);
      notifications.show({
        title: "Success",
        message: `List "${newListId}" created successfully.`,
        color: "green",
      });
      onListCreated(newListId);
      setListId(newListId);
      setCreateModalOpened(false);
      setNewListId("");
      setInitialMemberNetId("");
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not create the new list.";
      notifications.show({
        title: "Creation Failed",
        message: errorMessage,
        color: "red",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleReplaceList = () => {
    const allLines = replacementList
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const validNetIds = new Set<string>();
    const invalidEntries: string[] = [];

    for (const line of allLines) {
      // Rule: If it contains "@" but is not a valid "@illinois.edu" email, it's invalid.
      if (line.includes("@") && !line.endsWith("@illinois.edu")) {
        invalidEntries.push(line);
        continue;
      }

      // Strip the domain to get the potential NetID for Zod validation
      const potentialNetId = line.replace("@illinois.edu", "");

      if (illinoisNetId.safeParse(potentialNetId).success) {
        validNetIds.add(potentialNetId);
      } else {
        invalidEntries.push(line); // Add the original failing line
      }
    }

    if (invalidEntries.length > 0) {
      const pluralize = (singular: string, plural: string, count: number) =>
        count === 1 ? singular : plural;
      const verbIs = pluralize("is", "are", invalidEntries.length);
      const verbHas = pluralize("has", "have", invalidEntries.length);
      const entriesStr = invalidEntries.join(", ");

      notifications.show({
        title: "Invalid Entries Skipped",
        message: `${entriesStr} ${verbIs} invalid and ${verbHas} been ignored.`,
        color: "orange",
      });
    }

    const currentMembersSet = new Set(members);
    const membersToAdd = [...validNetIds].filter(
      (id) => !currentMembersSet.has(id),
    );
    const membersToRemove = [...currentMembersSet].filter(
      (id) => !validNetIds.has(id),
    );

    setToAdd(membersToAdd);
    setToRemove(membersToRemove);

    setReplaceModalOpened(false);
    setReplacementList("");
    if (membersToAdd.length + membersToRemove.length > 0) {
      notifications.show({
        title: "Changes Computed",
        message: `Queued ${membersToAdd.length} additions and ${membersToRemove.length} removals. Click 'Save Changes' to apply.`,
        color: "blue",
      });
    } else {
      notifications.show({
        title: "No Changes Found",
        message: `Both lists are the same.`,
        color: "green",
      });
    }
  };

  const rows = paginatedData.map((member) => {
    const isQueuedForAddition = toAdd.includes(member);
    const isQueuedForRemoval = toRemove.includes(member);
    let statusBadge, actionButton;

    if (isQueuedForRemoval) {
      statusBadge = (
        <Badge color="red" variant="light">
          Queued for removal
        </Badge>
      );
      actionButton = (
        <Button
          color="gray"
          variant="light"
          size="xs"
          onClick={() => handleCancelRemove(member)}
        >
          Cancel
        </Button>
      );
    } else if (isQueuedForAddition) {
      statusBadge = (
        <Badge color="blue" variant="light">
          Queued for addition
        </Badge>
      );
      actionButton = (
        <Button
          color="red"
          variant="light"
          size="xs"
          leftSection={<IconTrash size={14} />}
          onClick={() => handleCancelAdd(member)}
        >
          Cancel Add
        </Button>
      );
    } else {
      statusBadge = (
        <Badge color="green" variant="light">
          Active
        </Badge>
      );
      actionButton = (
        <Button
          color="red"
          variant="light"
          size="xs"
          onClick={() => handleQueueRemove(member)}
          leftSection={<IconTrash size={14} />}
        >
          Remove
        </Button>
      );
    }

    return (
      <Table.Tr key={member} style={{ opacity: isQueuedForRemoval ? 0.5 : 1 }}>
        <Table.Td>
          <Group gap="sm">
            <Avatar name={member} color="initials" />
            <Text fz="sm" fw={500}>
              {member}
            </Text>
          </Group>
        </Table.Td>
        <Table.Td>{statusBadge}</Table.Td>
        <Table.Td>{actionButton}</Table.Td>
      </Table.Tr>
    );
  });

  return (
    <Box>
      <Group align="flex-end" mb="xl">
        <Select
          style={{ flex: 1 }}
          label="Select a Member List"
          placeholder="Pick a list to manage"
          data={validLists}
          value={listId}
          onChange={setListId}
          allowDeselect={false}
          disabled={isLoading}
        />
        <AuthGuard
          isAppShell={false}
          resourceDef={{
            service: "core",
            validRoles: [AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST],
          }}
        >
          <Button
            onClick={() => setCreateModalOpened(true)}
            disabled={isLoading}
          >
            New List
          </Button>
          <Button
            variant="outline"
            onClick={() => setReplaceModalOpened(true)}
            disabled={isLoading || !listId}
          >
            Replace List
          </Button>
        </AuthGuard>
      </Group>

      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Member NetID</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !members.length ? (
            Array.from({ length: 5 }).map((_, index) => (
              <Table.Tr key={`skeleton-${index}`}>
                <Table.Td>
                  <Group gap="sm">
                    <Skeleton height={38} circle />
                    <Box>
                      <Skeleton height={12} width={120} mb={4} />
                    </Box>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Skeleton height={22} width={100} radius="xl" />
                </Table.Td>
                <Table.Td>
                  <Skeleton height={28} width={90} radius="sm" />
                </Table.Td>
              </Table.Tr>
            ))
          ) : rows.length > 0 ? (
            rows
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text c="dimmed" ta="center" p="md">
                  {listId
                    ? "This list has no members."
                    : "Select a list to begin."}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Stack justify="center" align="center" mt="md">
        <Text size="sm" c="dimmed">
          Found {members.length} {pluralize("member", members.length)}.
        </Text>
        {totalPages > 1 && (
          <Pagination
            total={totalPages}
            value={activePage}
            onChange={setPage}
            disabled={isLoading}
          />
        )}
      </Stack>

      <AuthGuard
        isAppShell={false}
        resourceDef={{
          service: "core",
          validRoles: [AppRoles.MANAGE_EXTERNAL_MEMBERSHIP_LIST],
        }}
      >
        <Group mt="xl" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            value={newMemberNetId}
            onChange={(e) => setNewMemberNetId(e.currentTarget.value)}
            placeholder="Enter NetID"
            label="Add New Member by NetID"
            disabled={isLoading || !listId}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleAddMember();
              }
            }}
          />
          <Button
            leftSection={<IconUserPlus size={16} />}
            onClick={handleAddMember}
            disabled={isLoading || !listId}
          >
            Queue Add
          </Button>
        </Group>
        <Button
          fullWidth
          color="blue"
          mt="xl"
          onClick={() => setConfirmationModalOpened(true)}
          disabled={(!toAdd.length && !toRemove.length) || isLoading}
          loading={isLoading}
        >
          Save Changes ({toAdd.length} Additions, {toRemove.length} Removals)
        </Button>
      </AuthGuard>

      <Modal
        opened={confirmationModalOpened}
        onClose={() => setConfirmationModalOpened(false)}
        title="Confirm Changes"
        centered
      >
        {toAdd.length > 0 && (
          <Box mb="md">
            <Text fw={500} size="sm" mb="xs">
              Members to Add:
            </Text>
            {toAdd.length > CHANGE_DISPLAY_LIMIT ? (
              <Accordion variant="separated" radius="md">
                <Accordion.Item value="add-list">
                  <Accordion.Control>
                    <Text fz="sm">{toAdd.length} members</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <ScrollArea h={200}>
                      {toAdd.map((netId) => (
                        <Text key={netId} fz="sm" py={2}>
                          - {netId}
                        </Text>
                      ))}
                    </ScrollArea>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            ) : (
              toAdd.map((netId) => (
                <Text key={netId} fz="sm">
                  {" "}
                  - {netId}
                </Text>
              ))
            )}
          </Box>
        )}
        {toRemove.length > 0 && (
          <Box>
            <Text fw={500} size="sm" mb="xs">
              Members to Remove:
            </Text>
            {toRemove.length > CHANGE_DISPLAY_LIMIT ? (
              <Accordion variant="separated" radius="md">
                <Accordion.Item value="remove-list">
                  <Accordion.Control>
                    <Text fz="sm" c="red">
                      {toRemove.length} members
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <ScrollArea h={200}>
                      {toRemove.map((netId) => (
                        <Text key={netId} fz="sm" c="red" py={2}>
                          - {netId}
                        </Text>
                      ))}
                    </ScrollArea>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            ) : (
              toRemove.map((netId) => (
                <Text key={netId} fz="sm" c="red">
                  {" "}
                  - {netId}
                </Text>
              ))
            )}
          </Box>
        )}
        <Group justify="flex-end" mt="lg">
          <Button
            variant="outline"
            onClick={() => setConfirmationModalOpened(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSaveChanges} loading={isLoading} color="blue">
            Confirm and Save
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        title="Create a New Member List"
        centered
      >
        <TextInput
          label="New List ID"
          placeholder="e.g., my-new-group-123"
          value={newListId}
          onChange={(e) => setNewListId(e.currentTarget.value)}
          data-autofocus
          required
        />
        <TextInput
          label="Initial Member NetID"
          placeholder="Enter a valid NetID"
          value={initialMemberNetId}
          onChange={(e) => setInitialMemberNetId(e.currentTarget.value)}
          mt="md"
          required
        />
        <Group justify="flex-end" mt="lg">
          <Button
            variant="outline"
            onClick={() => setCreateModalOpened(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreateWithInitialMember} loading={isCreating}>
            Create List
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={replaceModalOpened}
        onClose={() => setReplaceModalOpened(false)}
        title="Replace List Members"
        centered
        size="lg"
      >
        <Text c="dimmed" size="sm" mb="md">
          Paste a list of NetIDs separated by new lines. This will calculate the
          necessary additions and removals to match the list you provide.
        </Text>
        <Textarea
          placeholder={"jdoe2\nasmith3@illinois.edu\njohns4"}
          value={replacementList}
          onChange={(e) => setReplacementList(e.currentTarget.value)}
          autosize
          minRows={10}
          data-autofocus
        />
        <Group justify="flex-end" mt="lg">
          <Button
            variant="outline"
            onClick={() => setReplaceModalOpened(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleReplaceList}>Compute Changes</Button>
        </Group>
      </Modal>
    </Box>
  );
};

export default ExternalMemberListManagement;
