import { Title, Box, TextInput, Textarea, Switch, Select, Button, Loader } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm, zodResolver } from '@mantine/form';
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

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const repeatOptions = ['weekly', 'biweekly'] as const;

const baseBodySchema = z.object({
  slug: z.string().min(1).optional(),
  access: z.string().min(1).optional(),
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

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    // Fetch event data and populate form
    const getEvent = async () => {
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
    getEvent();
  }, [eventId, isEditing]);

  const form = useForm<LinkPostRequest>({
    validate: zodResolver(requestBodySchema),
    initialValues: {
      slug: '',
      access: '',
      redirect: '',
    },
  });

  // const checkPaidEventId = async (paidEventId: string) => {
  //   try {
  //     const merchEndpoint = getRunEnvironmentConfig().ServiceConfiguration.merch.baseEndpoint;
  //     const ticketEndpoint = getRunEnvironmentConfig().ServiceConfiguration.tickets.baseEndpoint;
  //     const paidEventHref = paidEventId.startsWith('merch:')
  //       ? `${merchEndpoint}/api/v1/merch/details?itemid=${paidEventId.slice(6)}`
  //       : `${ticketEndpoint}/api/v1/event/details?eventid=${paidEventId}`;
  //     const response = await api.get(paidEventHref);
  //     return Boolean(response.status < 299 && response.status >= 200);
  //   } catch (error) {
  //     console.error('Error validating paid event ID:', error);
  //     return false;
  //   }
  // };

  const handleSubmit = async (values: LinkPostRequest) => {
    try {
      setIsSubmitting(true);
      const realValues = {
        ...values,
      };

      const linkURL = isEditing ? `/api/v1/events/${eventId}` : '/api/v1/linkry/redir';
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
        message: 'Failed to create/edit link, please try again.',
      });
    }
  };

  const handleFormClose = () => {
    navigate('/link-shortener');
  };

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.EVENTS_MANAGER] }}>
      <Box display="flex" ta="center" mt="1.5rem">
        <Title order={2}>Add Link</Title>
        <Button variant="subtle" ml="auto" onClick={handleFormClose}>
          Close
        </Button>
      </Box>
      <Box maw={400} mx="auto" mt="xl">
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label="URL to Shorten"
            withAsterisk
            placeholder="URl to shorten"
            {...form.getInputProps('slug')}
          />
          <TextInput
            label="Redirect/Shorten URL"
            withAsterisk
            placeholder="Redirect/Shorten URL"
            {...form.getInputProps('redirect')}
          />
          <TextInput
            label="Access Group"
            withAsterisk
            placeholder="Access Group"
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
