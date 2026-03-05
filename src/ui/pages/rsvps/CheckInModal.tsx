import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  Button,
  Stack,
  Text,
  Alert,
  Paper,
  TextInput,
  Group,
  Code,
  Badge,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCreditCard,
  IconCheck,
} from "@tabler/icons-react";
import { AxiosError } from "axios";

interface CheckInModalProps {
  opened: boolean;
  onClose: () => void;
  eventId: string;
  checkInAttendee: (
    eventId: string,
    userId: string,
  ) => Promise<{ upn: string; dietaryRestrictions: string[] }>;
}

export const CheckInModal: React.FC<CheckInModalProps> = ({
  opened,
  onClose,
  eventId,
  checkInAttendee,
}) => {
  const [error, setError] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [manualInput, setManualInput] = useState<string>("");
  const [lastCheckIn, setLastCheckIn] = useState<{
    userId: string;
    upn: string;
    dietaryRestrictions: string[];
    timestamp: Date;
    type: string;
  } | null>(null);

  const [checkInHistory, setCheckInHistory] = useState<
    Array<{
      userId: string;
      upn: string;
      dietaryRestrictions: string[];
      timestamp: Date;
      type: string;
    }>
  >([]);

  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const lastCheckInTime = useRef<number>(0);
  const checkInCooldownMs = 2000;

  useEffect(() => {
    if (opened) {
      // Focus the input when modal opens so card swipes are captured
      setTimeout(() => {
        manualInputRef.current?.focus();
      }, 100);
    } else {
      // Reset state when modal closes
      setError("");
      setManualInput("");
      setLastCheckIn(null);
      setCheckInHistory([]);
      lastCheckInTime.current = 0;
    }
  }, [opened]);

  const parseInput = (
    input: string,
  ): { userId: string; type: string } | null => {
    let inputType = "Manual UIN Entry";

    if (input.startsWith("ACMCARD")) {
      inputType = "ACM Card Swipe"; // Set the type if a swipe is detected
      const uinMatch = input.match(/^ACMCARD\d{4}(\d{9})/);

      if (uinMatch) {
        input = uinMatch[1];
      } else {
        const flexibleMatch = input.match(/ACMCARD\d*?(\d{9})/);
        input = flexibleMatch ? flexibleMatch[1] : input;
      }
    }

    if (/^\d{9}$/.test(input)) {
      return {
        userId: input,
        type: inputType, // Use the variable instead of the hardcoded string
      };
    }

    setError("Invalid input format. Enter a 9-digit UIN");
    return null;
  };

  const handleCheckIn = async (userId: string, type: string) => {
    // Cooldown check
    const now = Date.now();
    if (now - lastCheckInTime.current < checkInCooldownMs) {
      return;
    }

    lastCheckInTime.current = now;
    setProcessing(true);
    setError("");

    try {
      const result = await checkInAttendee(eventId, userId);

      const checkInData = {
        userId,
        upn: result.upn || userId,
        dietaryRestrictions: result.dietaryRestrictions || [],
        timestamp: new Date(),
        type,
      };

      setLastCheckIn(checkInData);
      setCheckInHistory((prev) => [checkInData, ...prev].slice(0, 10)); // Keep last 10

      // Success feedback
      setTimeout(() => {
        setProcessing(false);
      }, 1000);
    } catch (error: any) {
      if (error instanceof AxiosError && error.status === 400) {
        setError("Attendee has not RSVP'd");
      } else {
        const errorMessage = "Failed to check in attendee.";
        setError(errorMessage);
      }
      setProcessing(false);
    }
  };

  const handleManualInputSubmit = async () => {
    if (!manualInput.trim()) {
      return;
    }

    const inputValue = manualInput.trim();
    setManualInput("");

    const parsed = parseInput(inputValue);
    if (!parsed) {
      // Error already set in parseInput
      setTimeout(() => {
        manualInputRef.current?.focus();
      }, 100);
      return;
    }

    await handleCheckIn(parsed.userId, parsed.type);

    // Refocus input for next scan
    setTimeout(() => {
      manualInputRef.current?.focus();
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleManualInputSubmit();
    }
  };

  const getColorForType = (type: string) => {
    switch (type) {
      case "ACM Card Swipe":
        return "violet";
      case "Manual UIN Entry":
        return "blue";
      default:
        return "gray";
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Check-In Attendee"
      size="lg"
      centered
    >
      <Stack gap="md">
        <Paper p="md" withBorder bg="blue.0">
          <Group gap="xs">
            <IconCreditCard size={24} />
            <Stack gap={0}>
              <Text size="sm" fw={600}>
                Card Swiper Ready
              </Text>
              <Text size="xs" c="dimmed">
                Swipe any iCard or enter UIN manually
              </Text>
            </Stack>
          </Group>
        </Paper>

        <TextInput
          label="Swipe iCard or Enter UIN"
          placeholder="Swipe card or type UIN"
          value={manualInput}
          onChange={(e) => setManualInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          ref={manualInputRef}
          disabled={processing}
          autoComplete="off"
          autoCapitalize="off"
          autoFocus
          autoCorrect="off"
          size="lg"
          leftSection={<IconCreditCard size={20} />}
        />

        <Button
          onClick={handleManualInputSubmit}
          disabled={processing || !manualInput.trim()}
          loading={processing}
          size="lg"
          fullWidth
        >
          Check In
        </Button>

        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Check-In Error"
            color="red"
            variant="filled"
          >
            {error}
          </Alert>
        )}

        {lastCheckIn && (
          <Paper p="md" withBorder bg="green.0">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Group gap="xs">
                    <IconCheck size={20} color="green" />
                    <Text fw={700} size="lg">
                      Check-In Successful
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {lastCheckIn.timestamp.toLocaleTimeString()}
                  </Text>
                </Stack>
                <Badge color={getColorForType(lastCheckIn.type)} size="lg">
                  {lastCheckIn.type}
                </Badge>
              </Group>
              <Paper p="sm" withBorder bg="white">
                <Stack gap="xs">
                  <Text fw={600} size="sm">
                    UPN:
                  </Text>
                  <Code>{lastCheckIn.upn}</Code>
                  {lastCheckIn.dietaryRestrictions.length > 0 && (
                    <>
                      <Text fw={600} size="sm">
                        Dietary Restrictions:
                      </Text>
                      <Group gap="xs">
                        {lastCheckIn.dietaryRestrictions.map((restriction) => (
                          <Badge key={restriction} color="orange">
                            {restriction}
                          </Badge>
                        ))}
                      </Group>
                    </>
                  )}
                  {lastCheckIn.dietaryRestrictions.length === 0 && (
                    <Text size="sm" c="dimmed">
                      No dietary restrictions
                    </Text>
                  )}
                </Stack>
              </Paper>
            </Stack>
          </Paper>
        )}

        {checkInHistory.length > 1 && (
          <Paper p="md" withBorder>
            <Stack gap="sm">
              <Text fw={700} size="md">
                Recent Check-Ins ({checkInHistory.length - 1} previous)
              </Text>
              <Stack gap="xs">
                {checkInHistory.slice(1, 6).map((checkIn, idx) => (
                  <Paper key={idx} p="sm" withBorder bg="gray.0">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Badge color={getColorForType(checkIn.type)} size="sm">
                          {checkIn.type}
                        </Badge>
                        <Text size="sm" fw={500}>
                          {checkIn.userId}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {checkIn.timestamp.toLocaleTimeString()}
                      </Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          </Paper>
        )}

        <Paper p="sm" withBorder bg="gray.0">
          <Text size="xs" c="dimmed" ta="center">
            Swipe Student Card or Enter UIN
          </Text>
        </Paper>
      </Stack>
    </Modal>
  );
};
