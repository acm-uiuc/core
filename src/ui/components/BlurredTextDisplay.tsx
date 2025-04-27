import React, { useState } from "react";
import { Text, Overlay, Box, ActionIcon } from "@mantine/core";
import { IconEye, IconEyeOff } from "@tabler/icons-react";

export const BlurredTextDisplay: React.FC<{
  text: string;
  initialState?: boolean;
}> = ({ text, initialState = false }) => {
  const [visible, setVisible] = useState(initialState);

  return (
    <Box pos="relative" maw={400} mx="auto">
      <Text
        ta="center"
        fw={600}
        fz="sm"
        p="md"
        bg="var(--mantine-color-gray-light)"
        style={{
          wordBreak: "break-all",
          borderRadius: 4,
        }}
      >
        {text}
      </Text>

      {!visible && (
        <Overlay
          blur={7}
          radius={3}
          opacity={1}
          color="var(--mantine-color-gray-light)"
          zIndex={5}
          center
          style={{
            position: "absolute", // Made position explicit
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      )}

      <ActionIcon
        variant="light"
        size="sm"
        onClick={() => setVisible((v) => !v)}
        pos="absolute"
        top={5}
        right={5}
        style={{ zIndex: 10 }}
      >
        {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </ActionIcon>
    </Box>
  );
};
