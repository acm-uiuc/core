import {
  Title,
  Box,
  TextInput,
  Textarea,
  Switch,
  Select,
  Button,
  Loader,
  TextInputProps,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm, zodResolver } from '@mantine/form';
import { MultiSelect } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { AuthGuard } from '@ui/components/AuthGuard';
import { getRunEnvironmentConfig } from '@ui/config';
import { useApi } from '@ui/util/api';
import { OrganizationList as orgList } from '@common/orgs';
import { AppRoles } from '@common/roles';
import { v4 as uuidv4 } from 'uuid';

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const repeatOptions = ['weekly', 'biweekly'] as const;

const slugRegex = new RegExp('^(https?://)?[a-zA-Z0-9-._/]*$');

const accessGroup = [
  'ACM Link Shortener Manager',
  'ACM Exec',
  'ACM Officers',
  'ACM Infra Leadership',
];

const baseBodySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(
      slugRegex,
      "Invalid input: Only alphanumeric characters, '-', '_', '/', and '.' are allowed"
    )
    .optional(),
  access: z.array(z.string()).min(1).optional(),
  redirect: z.string().min(1).optional(),
  createdAtUtc: z.number().optional(),
  updatedAtUtc: z.number().optional(),
});

const requestBodySchema = baseBodySchema;

type LinkPostRequest = z.infer<typeof requestBodySchema>;

export const ManageLinkPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const navigate = useNavigate();
  const api = useApi('core');

  const { eventId } = useParams();

  const isEditing = false; //= eventId !== undefined;

  /*useEffect(() => {
    if (!isEditing) {
      return;
    }
    // Fetch event data and populate form
    const startForm = async () => {
      try {
        const response = await api.get(`/api/v1/events/${eventId}`);
        const eventData = response.data;
        const formValues = {
          slug: eventData.slug,
          access: eventData.access,
          redirect: eventData.redirects,
        };
        form.setValues(formValues);
      } catch (error) {
        console.error('Error fetching event data:', error);
        notifications.show({
          message: 'Failed to fetch event data, please try again.',
        });
      }
    };
    startForm();
  }, [eventId, isEditing]);*/

  const form = useForm<LinkPostRequest>({
    validate: zodResolver(requestBodySchema),
    initialValues: {
      slug: '',
      access: [],
      redirect: '',
    },
  });

  const handleSubmit = async (values: LinkPostRequest) => {
    try {
      setIsSubmitting(true);
      const realValues = {
        ...values,
      };
      const linkURL = '/api/v1/linkry/redir';
      const response = await api.post(linkURL, realValues);
      notifications.show({
        title: isEditing ? 'Link updated!' : 'Link created!',
        message: isEditing ? undefined : `The Link ID is "${response.data.id}".`,
      });
      navigate('/link-shortener');
    } catch (error) {
      setIsSubmitting(false);
      console.error('Error creating/editing link:', error);
      notifications.show({
        message: 'Failed to create/edit link',
      });
    }
  };

  const handleFormClose = () => {
    navigate('/link-shortener');
  };

  const generateRandomSlug = () => {
    const randomSlug = uuidv4().substring(0, 5);
    notifications.show({
      message: randomSlug, //first 6 digits of uuid
    });
    form.setFieldValue('slug', randomSlug);
  };

  const handleSlug = (e: TextInputProps) => {
    form.setFieldValue('slug', e.value?.toString());
  };

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.EVENTS_MANAGER] }}>
      <Box display="flex" ta="center" mt="1.5rem">
        <Title order={2}>Add Link</Title>
        <Button variant="subtle" ml="auto" onClick={handleFormClose}>
          Close
        </Button>
      </Box>
      <Box maw={600} mx="auto" mt="xl">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label="URL to be Shorten"
            withAsterisk
            placeholder="Paste URL here to Shorten"
            style={{ marginBottom: '20px' }}
            {...form.getInputProps('redirect')}
          />

          <TextInput
            label="Alias"
            withAsterisk
            leftSectionWidth={'100px'}
            rightSectionWidth={'140px'}
            rightSection={
              <Button variant="filled" ml="auto" color="blue" onClick={generateRandomSlug}>
                Random URL
              </Button>
            }
            placeholder="Enter an Alias for redirecting to your url"
            {...{ ...form.getInputProps('slug'), onChange: handleSlug }}
            style={{ marginBottom: '20px' }}
          />

          <MultiSelect
            label="Access Group"
            withAsterisk
            placeholder="Select Access Group"
            data={accessGroup}
            {...form.getInputProps('access')}
          />

          <Button type="submit" mt="md">
            {isSubmitting ? (
              <>
                <Loader size={16} color="white" />
                Submitting...
              </>
            ) : (
              `${isEditing ? 'Save' : 'Create'} Event`
            )}
          </Button>
        </form>
      </Box>
    </AuthGuard>
  );
};
