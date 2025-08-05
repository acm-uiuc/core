import { useState } from "react";
import {
  TextInput,
  Button,
  Stack,
  Box,
  Text,
  Group,
  Loader,
} from "@mantine/core";
import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";

interface InternalMembershipQueryProps {
  queryInternalMembership: (netId: string) => Promise<boolean>;
}

export const InternalMembershipQuery = ({
  queryInternalMembership,
}: InternalMembershipQueryProps) => {
  const [netId, setNetId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    netId: string;
    isMember: boolean;
  } | null>(null);

  const handleQuery = async () => {
    if (!netId.trim()) {
      return;
    }

    setIsLoading(true);
    setResult(null); // Clear previous results on new query
    try {
      const isMember = await queryInternalMembership(netId.trim());
      setResult({ netId: netId.trim(), isMember });
    } catch (error) {
      // The parent component's passed-in function already handles notifications
      console.error(`Query failed for ${netId}:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Stack gap="md">
      <TextInput
        label="NetID"
        placeholder="e.g., jdoe2"
        value={netId}
        onChange={(event) => setNetId(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleQuery();
          }
        }}
      />
      <Button
        onClick={handleQuery}
        loading={isLoading}
        disabled={!netId.trim()}
      >
        Query Membership
      </Button>

      {result && (
        <Box
          p="md"
          mt="sm"
          style={{ borderRadius: "var(--mantine-radius-md)" }}
          bg={result.isMember ? "green.1" : "red.1"}
        >
          <Group>
            {result.isMember ? (
              <IconCircleCheck
                style={{ color: "var(--mantine-color-green-7)" }}
              />
            ) : (
              <IconCircleX style={{ color: "var(--mantine-color-red-7)" }} />
            )}
            <Text c={result.isMember ? "green.9" : "red.9"} fw={500}>
              <Text span fw={700} inherit>
                {result.netId}
              </Text>{" "}
              is {result.isMember ? "" : "not "}a paid member.
            </Text>
          </Group>
        </Box>
      )}
    </Stack>
  );
};

export default InternalMembershipQuery;
