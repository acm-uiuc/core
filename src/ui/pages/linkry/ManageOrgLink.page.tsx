import {
  Title,
  Box,
  TextInput,
  Button,
  Loader,
  Container,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import * as z from "zod/v4";
import { AuthGuard } from "@ui/components/AuthGuard";
import { useApi } from "@ui/util/api";
import { AppRoles } from "@common/roles";
import { IconDeviceFloppy } from "@tabler/icons-react";
import FullScreenLoader from "@ui/components/AuthContext/LoadingScreen";
import { LINKRY_MAX_SLUG_LENGTH, OrgLinkRecord } from "@common/types/linkry";
import { getRunEnvironmentConfig } from "@ui/config";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import { Organizations, OrganizationId } from "@acm-uiuc/js-shared";

const baseUrl = getRunEnvironmentConfig().LinkryPublicUrl;
const slugRegex = new RegExp("^(https?://)?[a-zA-Z0-9-._/]*$");
const urlRegex = new RegExp("^https?://[a-zA-Z0-9-._/?=&+:]*$");

const orgLinkBodySchema = z
  .object({
    slug: z
      .string()
      .min(0, "Enter or generate an alias")
      .regex(
        slugRegex,
        "Invalid input: Only alphanumeric characters, '-', '_', '/', and '.' are allowed",
      )
      .refine((url) => !url.includes("#"), {
        message: "Slug must not contain a hashtag",
      })
      .optional(),
    redirect: z
      .string()
      .min(1)
      .regex(
        urlRegex,
        "Invalid URL. Use format: https:// or https://www.example.com",
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.slug?.length || 0) > LINKRY_MAX_SLUG_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slug"],
        message: "Shortened URL cannot be that long",
      });
    }
  });

type OrgLinkPostRequest = z.infer<typeof orgLinkBodySchema>;

export const ManageOrgLinkPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isEdited, setIsEdited] = useState<boolean>(false);

  const navigate = useNavigate();
  const api = useApi("core");
  const [searchParams] = useSearchParams();
  const { slug } = useParams();

  const orgId = searchParams.get("org") as OrganizationId | null;
  const isEditing = slug !== undefined;

  const orgName =
    orgId && Organizations[orgId] ? Organizations[orgId].name : orgId;
  const orgShortcode =
    orgId && Organizations[orgId] ? Organizations[orgId].shortcode : null;

  useEffect(() => {
    if (!orgId) {
      notifications.show({
        message: "No organization specified.",
        color: "red",
      });
      navigate("/linkry");
      return;
    }

    if (!isEditing) {
      return;
    }

    const loadLink = async () => {
      try {
        setIsLoading(true);
        const response = await api.get(
          `/api/v1/linkry/orgs/${encodeURIComponent(orgId)}/redir`,
        );
        const links: OrgLinkRecord[] = response.data;
        const fullSlug = `${orgId}#${slug}`;
        const match = links.find((l) => l.slug === fullSlug);
        if (!match) {
          notifications.show({
            message: "Link not found.",
            color: "red",
          });
          navigate(`/linkry?org=${encodeURIComponent(orgId)}`);
          return;
        }
        form.setValues({
          slug: match.slug.replace(`${orgId}#`, ""),
          redirect: match.redirect,
        });
        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching org link data:", error);
        notifications.show({
          message: "Failed to fetch link data, please try again.",
        });
        navigate(`/linkry?org=${encodeURIComponent(orgId)}`);
      }
    };
    loadLink();
  }, []);

  const form = useForm<OrgLinkPostRequest>({
    validate: zodResolver(orgLinkBodySchema),
    initialValues: {
      slug: "",
      redirect: "",
    },
  });

  const handleSubmit = async (values: OrgLinkPostRequest) => {
    if (!orgId) {
      return;
    }
    try {
      setIsSubmitting(true);
      await api.post(`/api/v1/linkry/orgs/${encodeURIComponent(orgId)}/redir`, {
        slug: values.slug,
        redirect: values.redirect,
      });
      notifications.show({
        message: isEditing ? "Org link updated!" : "Org link created!",
      });
      navigate(`/linkry?org=${encodeURIComponent(orgId)}`);
    } catch (error: any) {
      setIsSubmitting(false);
      console.error("Error creating/editing org link:", error);
      notifications.show({
        color: "red",
        title: isEditing
          ? "Failed to edit org link"
          : "Failed to create org link",
        message:
          error.response && error.response.data
            ? error.response.data.message
            : undefined,
      });
    }
  };

  const handleFormClose = () => {
    navigate(`/linkry?org=${encodeURIComponent(orgId || "")}`);
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
    setIsEdited(true);
  };

  if (isLoading) {
    return <FullScreenLoader />;
  }

  return (
    <AuthGuard
      resourceDef={{
        service: "core",
        validRoles: [AppRoles.AT_LEAST_ONE_ORG_MANAGER, AppRoles.LINKS_ADMIN],
      }}
    >
      <Container>
        <Title order={2}>
          {isEditing ? "Edit" : "Add"} Link for {orgName}
        </Title>
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
                  {orgShortcode}.{baseUrl}
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
                handleFormChange();
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
                handleFormChange();
              }}
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
