import {
  Title,
  Box,
  TextInput,
  Button,
  Loader,
  Container,
  MultiSelect,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as z from "zod/v4";
import { AuthGuard } from "@ui/components/AuthGuard";
import { generateErrorMessage, useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { LinkryGroupUUIDToGroupNameMap } from "@common/config";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { LINKRY_MAX_SLUG_LENGTH } from "@common/types/linkry";
import { getRunEnvironmentConfig } from "@ui/config";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const baseUrl = getRunEnvironmentConfig().LinkryPublicUrl;
const slugRegex = new RegExp("^(https?://)?[a-zA-Z0-9-._/]*$");
const urlRegex = new RegExp("^https?://[a-zA-Z0-9-._/?=&+:]*$");

const baseBodySchema = z
  .object({
    slug: z
      .string()
      .min(1, "Enter or generate an alias")
      .regex(
        slugRegex,
        "Invalid input: Only alphanumeric characters, '-', '_', '/', and '.' are allowed",
      )
      .optional(),
    access: z.array(z.string()).optional(),
    redirect: z
      .string()
      .min(1)
      .regex(
        urlRegex,
        "Invalid URL. Use format: https:// or https://www.example.com",
      )
      .optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    counter: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.slug?.length || 0) > LINKRY_MAX_SLUG_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slug"],
        message: "Shortened URL cannot be that long",
      }); //Throw custom error through context using superrefine
    }
  });

const requestBodySchema = baseBodySchema;

type LinkPostRequest = z.infer<typeof requestBodySchema>;

export function getFilteredUserGroups(groups: string[]) {
  return groups.filter((groupId) =>
    [...LinkryGroupUUIDToGroupNameMap.keys()].includes(groupId),
  );
}

export const ManageLinkPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [isEdited, setIsEdited] = useState<boolean>(false); // Track if the form is edited

  const navigate = useNavigate();
  const api = useApi("core");

  const { slug } = useParams();

  const isEditing = slug !== undefined;

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    // Fetch event data and populate form
    const startForm = async () => {
      try {
        setIsLoading(true);
        const response = await api.get(`/api/v1/linkry/redir/${slug}`);
        const linkData = response.data;
        const formValues = {
          slug: linkData.slug,
          access: linkData.access,
          redirect: linkData.redirect,
        };
        form.setValues(formValues);
        setIsLoading(false);
      } catch (error) {
        await generateErrorMessage(error, "fetching the link details");
        navigate("/linkry");
      }
    };
    // decode JWT to get user groups
    startForm();
  }, []);

  const form = useForm<LinkPostRequest>({
    validate: zodResolver(requestBodySchema),
    initialValues: {
      slug: "",
      access: [],
      redirect: "",
    },
  });

  const handleSubmit = async (values: LinkPostRequest) => {
    /*if (!values.access || values.redirect || !values.slug){
      notifications.show({
        message: "Please fill in all entries",
      });
    }  */ //Potential warning for fields that are not filled...
    let response;
    try {
      setIsSubmitting(true);
      const realValues = {
        ...values,
        isEdited,
      };

      response = await api.post("/api/v1/linkry/redir", realValues);
      notifications.show({
        message: isEditing ? "Link updated!" : "Link created!",
      });
      navigate(
        new URLSearchParams(window.location.search).get("previousPage") ||
          "/linkry",
      );
    } catch (error: unknown) {
      setIsSubmitting(false);
      const operationName = isEditing
        ? "editing the link"
        : "creating the link";
      await generateErrorMessage(error, operationName);
    }
  };

  const generateRandomSlug = () => {
    const randomSlug = Array.from(
      { length: 6 },
      () =>
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[
          Math.floor(Math.random() * 52)
        ],
    ).join("");
    form.setFieldValue("slug", randomSlug);
  };

  const handleSlug = (event: React.ChangeEvent<HTMLInputElement>) => {
    form.setFieldValue("slug", event.currentTarget.value);
  };

  const handleFormChange = () => {
    setIsEdited(true); // Set the flag to true when any field is changed
  };

  if (isLoading) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.LINKS_MANAGER] }}
    >
      <Container>
        <Title order={2}>{isEditing ? "Edit" : "Add"} Link</Title>
        <Box>
          <form onSubmit={form.onSubmit(handleSubmit)}>
            <TextInput
              label="Short URL"
              description="Enter the alias which will redirect to your original site."
              withAsterisk
              leftSectionWidth="230px"
              rightSectionWidth="150px"
              leftSection={
                <Button variant="outline" mr="auto" size="auto">
                  {baseUrl}
                </Button>
              }
              rightSection={
                !isEditing && (
                  <Button
                    variant="filled"
                    ml="auto"
                    color="blue"
                    onClick={generateRandomSlug}
                  >
                    Random
                  </Button>
                )
              }
              mt="xl"
              {...{ ...form.getInputProps("slug"), onChange: handleSlug }}
              disabled={isEditing}
              onChange={(e) => {
                form.getInputProps("slug").onChange(e);
                handleFormChange(); // Mark as edited
              }}
            />
            <TextInput
              label="URL to shorten"
              description="Enter a valid web URL."
              withAsterisk
              mt="xl"
              {...form.getInputProps("redirect")}
              onChange={(e) => {
                form.getInputProps("redirect").onChange(e);
                handleFormChange(); // Mark as edited
              }}
            />
            <MultiSelect
              label="Access Delegation"
              description="Select groups which are permitted to manage this link."
              data={
                [...LinkryGroupUUIDToGroupNameMap.keys()].map((x) => ({
                  value: x,
                  label: LinkryGroupUUIDToGroupNameMap.get(x) || x,
                })) ?? []
              }
              value={form.values.access}
              onChange={(value) => {
                form.setFieldValue("access", value);
                handleFormChange();
              }}
              mt="xl"
            />
            <Button
              disabled={!isEdited}
              type="submit"
              mt="md"
              leftSection={
                isSubmitting ? (
                  <Loader size={16} color="white" mr="sm" />
                ) : (
                  <IconDeviceFloppy size={16} color="white" />
                )
              }
            >
              {isSubmitting ? "Submitting..." : "Save"}
            </Button>
          </form>
        </Box>
      </Container>
    </AuthGuard>
  );
};
