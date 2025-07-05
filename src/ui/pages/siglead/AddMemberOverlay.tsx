import { Modal, Button, TextInput, Group, Box } from "@mantine/core";
import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useApi } from "@ui/util/api";
import { z } from "zod";
import { AxiosInstance } from "axios";
import { SigMemberUpdateRecord } from "@common/types/siglead";
import { getFormattedTimeNow } from "@common/utils";
import { IconTrash } from "@tabler/icons-react";

// add member flow
/* 
1. add permissions to azure
    i. email only
2. add to dynamo
    i. get uuid from azure call above
        is uuid necessary atp? just email is okay then...
    ii. set designation (M)
    iii. createdAt + updatedAt current time
    iv. grab sig id fed fed from outside
*/
async function handleBackendRequest(
  api: AxiosInstance,
  payload: SigMemberUpdateRecord,
) {
  const azureResponse = await api.patch(
    `/api/v1/iam/groups/${payload.sigGroupId}`,
    {
      add: [payload.email],
      remove: [],
    },
  );

  // TODO: remove when done, for testing only
  notifications.show({
    message: JSON.stringify(azureResponse),
  });

  const awsResponse = await api.post(
    "/api/v1/siglead/addMemberDynamo",
    payload,
  );
  // TODO: remove when done, for testing only
  notifications.show({
    message: JSON.stringify(awsResponse),
  });
}

type Props = { sigid: string };
export default function AddMemberOverlayButton({ sigid }: Props) {
  const api = useApi("core");
  const [opened, { open, close }] = useDisclosure(false);
  const [email, setEmail] = useState("");
  const [fName, setFName] = useState("");
  const [lName, setLName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function clear() {
    setEmail("");
    setFName("");
    setLName("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault(); // Prevent page reload on form submission
    setIsLoading(true);

    if (!email.includes("@")) {
      notifications.show({
        title: "Invalid Email",
        message: "Please enter a valid email address.",
        color: "red",
      });
      setIsLoading(false);
      return;
    }

    try {
      await handleBackendRequest(api, {
        sigGroupId: sigid,
        email,
        memberName: `${fName} ${lName}`,
        designation: "M",
        createdAt: getFormattedTimeNow(),
        updatedAt: getFormattedTimeNow(),
      });
      notifications.show({
        title: "Success!",
        message: `An invitation has been sent to ${email}`,
        color: "green",
      });
      setIsLoading(false);
      close();
      clear();
    } catch (error) {
      notifications.show({
        title: "Database Error",
        message: `Add member failed: ${error}`,
        color: "red",
      });
      setIsLoading(false);
    }
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={close}
        title="Add Member"
        centered // Vertically centers the modal
      >
        <Box component="form" onSubmit={handleSubmit}>
          <TextInput
            required
            label="Member's Email"
            placeholder="netid@illinois.edu"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            data-autofocus // Automatically focus this input when the modal opens
          />
          <Group justify="space-between">
            <TextInput
              required
              label="First Name"
              placeholder="First"
              value={fName}
              onChange={(event) => setFName(event.currentTarget.value)}
            />
            <TextInput
              required
              label="Last Name"
              placeholder="Last"
              value={lName}
              onChange={(event) => setLName(event.currentTarget.value)}
            />
          </Group>

          {/* 3. The action buttons */}
          <Group justify="flex-end" mt="md">
            <Button onClick={clear} color="red">
              <IconTrash />
            </Button>
            <Button type="submit" loading={isLoading}>
              Submit
            </Button>
          </Group>
        </Box>
      </Modal>

      <Button onClick={open}>Add Member</Button>
    </>
  );
}
