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
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import {
  IconCircleCheck,
  IconCircleX,
  IconCopy,
  IconCheck,
  IconMail,
} from "@tabler/icons-react";

interface ResultSectionProps {
  title: string;
  items: string[];
  color: "green" | "red";
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
      <Box>
        {items.map((item) => (
          <Code
            key={item}
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

  const handleQuery = async () => {
    // Input processing logic remains the same
    const domainRegex = domain ? new RegExp(`@${domain}$`, "i") : null;
    const processedItems = input
      .split(/[;,\s\n]+/)
      .map((item) => {
        let cleanItem = item.trim().toLowerCase();
        if (domainRegex) {
          cleanItem = cleanItem.replace(domainRegex, "");
        }
        return cleanItem;
      })
      .filter(Boolean);

    const uniqueItems = [...new Set(processedItems)];
    if (uniqueItems.length === 0) {
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const queryResult = await queryFunction(uniqueItems);

      setResult(queryResult);
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

      {result && (
        <Stack gap="md" mt="sm">
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
          <ResultSection
            title="Not Paid Members"
            items={result.notMembers}
            color="red"
            icon={
              <IconCircleX style={{ color: "var(--mantine-color-white)" }} />
            }
            domain={domain}
          />
        </Stack>
      )}
    </Stack>
  );
};

export default MembershipListQuery;
