import { Title, TextInput, Button, Container, Group } from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { transformSigLeadToURI } from "@common/utils";

const baseSigSchema = z.object({
  signame: z
    .string()
    .min(1, "Title is required")
    .regex(
      /^[a-zA-Z0-9]+$/,
      "Sig name should only contain alphanumeric characters",
    ),
  description: z.string().min(1, "Description is required"),
});

type SigPostRequest = z.infer<typeof baseSigSchema>;

export const EditSigLeadsPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const navigate = useNavigate();
  const api = useApi("core");

  const form = useForm<SigPostRequest>({
    validate: zodResolver(baseSigSchema),
    initialValues: {
      signame: "",
      description: "",
    },
  });

  const checkSigId = async (signame: string) => {
    try {
      const sigid = transformSigLeadToURI(signame);
      const result = await api.get(`/api/v1/siglead/sigdetail/${sigid}`);
      return result.data;
    } catch (error) {
      console.error("Error validating if sigid already exists", error);
      notifications.show({
        message: `Error validating if sigid already exists`,
      });
    }
  };

  const handleSubmit = async (sigdetails: SigPostRequest) => {
    try {
      setIsSubmitting(true);
      const found = await checkSigId(sigdetails.signame);
      if (found) {
        form.setErrors({
          signame: "This signame is reserved already.",
        });
        setIsSubmitting(false);
        return;
      }
      notifications.show({
        message: `This will eventually make to a post request with signame: 
            ${sigdetails.signame} and description: ${sigdetails.description}  
            `,
      });
      //Post...
      navigate("/siglead-management");
    } catch (error) {
      setIsSubmitting(false);
      console.error("Error creating sig:", error);
      notifications.show({
        message: "Failed to create sig, please try again.",
      });
    }
  };

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.IAM_ADMIN] }}
    >
      <Container>
        <Title order={1}>Registering a new Sig</Title>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label="SIG Name"
            description="Enter your sig name"
            withAsterisk
            mt="xl"
            {...form.getInputProps("signame")}
          />
          <TextInput
            label="Description"
            description="Enter the description of your SIG"
            withAsterisk
            mt="xl"
            {...form.getInputProps("description")}
          />
          <Group mt="xl">
            <Button
              variant="outline"
              onClick={() => navigate("/siglead-management")}
            >
              {" "}
              Cancel{" "}
            </Button>
            <Button type="submit" variant="gradient">
              {" "}
              Submit{" "}
            </Button>
          </Group>
        </form>
      </Container>
    </AuthGuard>
  );
};
