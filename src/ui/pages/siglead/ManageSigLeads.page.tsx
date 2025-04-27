import {
  Title,
  Box,
  TextInput,
  Textarea,
  Switch,
  Select,
  Button,
  Loader,
  Container,
} from '@mantine/core';
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
import { ScreenComponent } from './SigScreenComponents';
import { GroupMemberGetResponse } from '@common/types/iam';
import { transformCommaSeperatedName } from '@common/utils';
import { orgsGroupId } from '@common/config';

export function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

const repeatOptions = ['weekly', 'biweekly'] as const;

const baseBodySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  start: z.date(),
  end: z.optional(z.date()),
  location: z.string().min(1, 'Location is required'),
  locationLink: z.optional(z.string().url('Invalid URL')),
  host: z.string().min(1, 'Host is required'),
  featured: z.boolean().default(false),
  paidEventId: z.string().min(1, 'Paid Event ID must be at least 1 character').optional(),
});

const requestBodySchema = baseBodySchema
  .extend({
    repeats: z.optional(z.enum(repeatOptions)).nullable(),
    repeatEnds: z.date().optional(),
  })
  .refine((data) => (data.repeatEnds ? data.repeats !== undefined : true), {
    message: 'Repeat frequency is required when Repeat End is specified.',
  })
  .refine((data) => !data.end || data.end >= data.start, {
    message: 'Event end date cannot be earlier than the start date.',
    path: ['end'],
  })
  .refine((data) => !data.repeatEnds || data.repeatEnds >= data.start, {
    message: 'Repeat end date cannot be earlier than the start date.',
    path: ['repeatEnds'],
  });

type EventPostRequest = z.infer<typeof requestBodySchema>;

export const ManageSigLeadsPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const navigate = useNavigate();
  const api = useApi('core');

  const { eventId } = useParams();

  const isEditing = eventId !== undefined;

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
          title: eventData.title,
          description: eventData.description,
          start: new Date(eventData.start),
          end: eventData.end ? new Date(eventData.end) : undefined,
          location: eventData.location,
          locationLink: eventData.locationLink,
          host: eventData.host,
          featured: eventData.featured,
          repeats: eventData.repeats,
          repeatEnds: eventData.repeatEnds ? new Date(eventData.repeatEnds) : undefined,
          paidEventId: eventData.paidEventId,
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

  const form = useForm<EventPostRequest>({
    validate: zodResolver(requestBodySchema),
    initialValues: {
      title: '',
      description: '',
      start: new Date(),
      end: new Date(new Date().valueOf() + 3.6e6), // 1 hr later
      location: 'ACM Room (Siebel CS 1104)',
      locationLink: 'https://maps.app.goo.gl/dwbBBBkfjkgj8gvA8',
      host: 'ACM',
      featured: false,
      repeats: undefined,
      repeatEnds: undefined,
      paidEventId: undefined,
    },
  });

  const checkPaidEventId = async (paidEventId: string) => {
    try {
      const merchEndpoint = getRunEnvironmentConfig().ServiceConfiguration.merch.baseEndpoint;
      const ticketEndpoint = getRunEnvironmentConfig().ServiceConfiguration.tickets.baseEndpoint;
      const paidEventHref = paidEventId.startsWith('merch:')
        ? `${merchEndpoint}/api/v1/merch/details?itemid=${paidEventId.slice(6)}`
        : `${ticketEndpoint}/api/v1/event/details?eventid=${paidEventId}`;
      const response = await api.get(paidEventHref);
      return Boolean(response.status < 299 && response.status >= 200);
    } catch (error) {
      console.error('Error validating paid event ID:', error);
      return false;
    }
  };

  const handleSubmit = async (values: EventPostRequest) => {
    try {
      setIsSubmitting(true);
      const realValues = {
        ...values,
        start: dayjs(values.start).format('YYYY-MM-DD[T]HH:mm:00'),
        end: values.end ? dayjs(values.end).format('YYYY-MM-DD[T]HH:mm:00') : undefined,
        repeatEnds:
          values.repeatEnds && values.repeats
            ? dayjs(values.repeatEnds).format('YYYY-MM-DD[T]HH:mm:00')
            : undefined,
        repeats: values.repeats ? values.repeats : undefined,
      };

      const eventURL = isEditing ? `/api/v1/events/${eventId}` : '/api/v1/events';
      const response = await api.post(eventURL, realValues);
      notifications.show({
        title: isEditing ? 'Event updated!' : 'Event created!',
        message: isEditing ? undefined : `The event ID is "${response.data.id}".`,
      });
      navigate('/events/manage');
    } catch (error) {
      setIsSubmitting(false);
      console.error('Error creating/editing event:', error);
      notifications.show({
        message: 'Failed to create/edit event, please try again.',
      });
    }
  };

  const getGroupMembers = async (selectedGroup: string) => {
    try {
      const response = await api.get(`/api/v1/iam/groups/${selectedGroup}`);
      const data = response.data as GroupMemberGetResponse;
      const responseMapped = data
        .map((x) => ({
          ...x,
          name: transformCommaSeperatedName(x.name),
        }))
        .sort((a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0));
      // console.log(responseMapped);
      return responseMapped;
    } catch (error) {
      console.error('Failed to get users:', error);
      return [];
    }
  };

  const TestButton: React.FC = () => {
    return (
      <Button
        fullWidth
        onClick={async () => {
          const response = await getGroupMembers(`${orgsGroupId}`);
          response.map(console.log);
        }}
      >
        Test
      </Button>
    );
  };

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.IAM_ADMIN] }}>
      <Container>
        <TestButton />
        <Title order={2}>SigLead Management System</Title>
        <ScreenComponent />
        {/* <SigTable /> */}
      </Container>
    </AuthGuard>
  );
};
