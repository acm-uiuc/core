import { useState } from "react";
import {
  Textarea,
  Button,
  Stack,
  Box,
  Group,
  Title,
  Code,
  ActionIcon,
  Tooltip,
  Collapse,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import {
  IconCircleCheck,
  IconCircleX,
  IconCopy,
  IconCheck,
  IconMail,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import { illinoisNetId } from "@common/types/generic";

interface ResultSectionProps {
  title: string;
  items: string[];
  color: "green" | "red" | "yellow";
  icon: React.ReactNode;
  domain?: string;
}

const ResultSection = ({
  title,
  items,
  color,
  icon,
  domain,
}: ResultSectionProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const clipboardIds = useClipboard({ timeout: 1000 });
  const clipboardEmails = useClipboard({ timeout: 1000 });

  const handleCopyEmails = () => {
    if (domain) {
      const emails = items.map((item) => `${item}@${domain}`).join(", ");
      clipboardEmails.copy(emails);
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <Box
      p="md"
      bg={`${color}.7`}
      style={{ borderRadius: "var(--mantine-radius-md)" }}
    >
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <ActionIcon
            variant="transparent"
            color="white"
            onClick={() => setIsOpen((o) => !o)}
            aria-label={isOpen ? "Collapse section" : "Expand section"}
          >
            {isOpen ? (
              <IconChevronUp size={20} />
            ) : (
              <IconChevronDown size={20} />
            )}
          </ActionIcon>
          {icon}
          <Title order={5} c="white">
            {title} ({items.length})
          </Title>
        </Group>
        <Group gap="xs">
          <Tooltip label="Copy as IDs">
            <ActionIcon
              variant="transparent"
              color="white"
              onClick={() => clipboardIds.copy(items.join(", "))}
            >
              {clipboardIds.copied ? (
                <IconCheck size={18} />
              ) : (
                <IconCopy size={18} />
              )}
            </ActionIcon>
          </Tooltip>
          {domain && (
            <Tooltip label="Copy as Emails">
              <ActionIcon
                variant="transparent"
                color="white"
                onClick={handleCopyEmails}
              >
                {clipboardEmails.copied ? (
                  <IconCheck size={18} />
                ) : (
                  <IconMail size={18} />
                )}
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      <Collapse in={isOpen}>
        <Box pt="xs" pl="xl">
          {items.map((item, index) => (
            <Code
              key={`${item}-${index}`}
              mr={5}
              mb={5}
              style={{
                display: "inline-block",
                color: "white",
                backgroundColor: "rgba(0, 0, 0, 0.25)",
              }}
            >
              {item}
            </Code>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

interface MembershipListQueryProps {
  queryFunction: (items: string[]) => Promise<{
    members: string[];
    notMembers: string[];
  }>;
  domain?: string;
  inputLabel?: string;
  inputDescription?: string;
  inputPlaceholder?: string;
  ctaText?: string;
}

export const MembershipListQuery = ({
  queryFunction,
  domain = "illinois.edu",
  inputLabel = "Enter NetIDs or Illinois Emails",
  inputDescription = "Enter items separated by commas, semicolons, spaces, or newlines.",
  inputPlaceholder = "e.g., rjjones, isbell@illinois.edu, ...",
  ctaText = "Query Memberships",
}: MembershipListQueryProps) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    members: string[];
    notMembers: string[];
  } | null>(null);
  const [invalidEntries, setInvalidEntries] = useState<string[]>([]);

  const handleQuery = async () => {
    setIsLoading(true);
    setResult(null);
    setInvalidEntries([]);

    const rawItems = input.split(/[;,\s\n]+/).filter(Boolean);
    const validItemsForQuery = new Set<string>();

    const allProcessedItems = rawItems.map((item) => {
      const trimmedItem = item.trim();
      let potentialNetId = trimmedItem.toLowerCase();
      let isValid = false;
      let cleanedNetId = "";

      if (potentialNetId.includes("@")) {
        if (domain && potentialNetId.endsWith(`@${domain}`)) {
          potentialNetId = potentialNetId.replace(`@${domain}`, "");
          if (illinoisNetId.safeParse(potentialNetId).success) {
            isValid = true;
            cleanedNetId = potentialNetId;
          }
        }
      } else if (illinoisNetId.safeParse(potentialNetId).success) {
        isValid = true;
        cleanedNetId = potentialNetId;
      }

      if (isValid) {
        validItemsForQuery.add(cleanedNetId);
      }

      return {
        original: trimmedItem,
        isValid,
        cleaned: cleanedNetId,
      };
    });

    if (validItemsForQuery.size === 0) {
      const invalidItems = allProcessedItems
        .filter((p) => !p.isValid)
        .map((p) => p.original);
      setInvalidEntries(
        invalidItems.filter(
          (item, index) => invalidItems.indexOf(item) === index,
        ),
      );
      setIsLoading(false);
      return;
    }

    try {
      const queryResult = await queryFunction([...validItemsForQuery]);
      const memberSet = new Set(queryResult.members);
      const orderedMembers: string[] = [];
      const orderedNotMembers: string[] = [];
      const orderedInvalid: string[] = [];

      allProcessedItems.forEach((item) => {
        if (!item.isValid) {
          orderedInvalid.push(item.original);
        } else if (memberSet.has(item.cleaned)) {
          orderedMembers.push(item.cleaned);
        } else {
          orderedNotMembers.push(item.cleaned);
        }
      });

      // --- THIS IS THE CORRECTED DEDUPLICATION LOGIC ---
      // For each list, keep only the first occurrence of each item.
      const uniqueMembers = orderedMembers.filter(
        (item, index) => orderedMembers.indexOf(item) === index,
      );
      const uniqueNotMembers = orderedNotMembers.filter(
        (item, index) => orderedNotMembers.indexOf(item) === index,
      );
      const uniqueInvalid = orderedInvalid.filter(
        (item, index) => orderedInvalid.indexOf(item) === index,
      );

      setResult({
        members: uniqueMembers,
        notMembers: uniqueNotMembers,
      });
      setInvalidEntries(uniqueInvalid);
    } catch (error) {
      console.error("An error occurred during the query:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Stack gap="md">
      <Textarea
        label={inputLabel}
        description={inputDescription}
        placeholder={inputPlaceholder}
        value={input}
        onChange={(event) => setInput(event.currentTarget.value)}
        autosize
        minRows={4}
        maxRows={10}
      />
      <Button
        onClick={handleQuery}
        loading={isLoading}
        disabled={!input.trim()}
      >
        {ctaText}
      </Button>

      <Stack gap="md" mt="sm">
        {result && (
          <>
            <ResultSection
              title="Paid Members"
              items={result.members}
              color="green"
              icon={
                <IconCircleCheck
                  style={{ color: "var(--mantine-color-white)" }}
                />
              }
              domain={domain}
            />
            {/* --- THIS LINE IS NOW FIXED --- */}
            <ResultSection
              title="Not Paid Members"
              items={result.notMembers}
              color="red"
              icon={
                <IconCircleX style={{ color: "var(--mantine-color-white)" }} />
              }
              domain={domain}
            />
          </>
        )}

        {invalidEntries.length > 0 && (
          <ResultSection
            title="Invalid Entries"
            items={invalidEntries}
            color="yellow"
            icon={
              <IconAlertTriangle
                style={{ color: "var(--mantine-color-white)" }}
              />
            }
          />
        )}
      </Stack>
    </Stack>
  );
};

export default MembershipListQuery;
