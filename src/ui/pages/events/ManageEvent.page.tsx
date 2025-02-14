import {
  Title,
  Box,
  TextInput,
  Textarea,
  Switch,
  Select,
  Button,
  Loader,
  Group,
  NumberInput,
  Checkbox,
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

export const ManageEventPage: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isPaidEvent, setIsPaidEvent] = useState<'ticket' | 'merch' | undefined>(undefined);
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
        type: isPaidEvent,
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

  const handleFormClose = () => {
    navigate('/events/manage');
  };

  return (
    <AuthGuard resourceDef={{ service: 'core', validRoles: [AppRoles.EVENTS_MANAGER] }}>
      <Box maw={800} mx="auto" mt="xl">
        <Box display="flex" ta="center" mt="xl">
          <Title order={2}>{isEditing ? `Edit` : `Create`} Event</Title>
          <Button variant="subtle" ml="auto" onClick={handleFormClose}>
            Close
          </Button>
        </Box>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <TextInput
            label="Event Title"
            withAsterisk
            placeholder="Event title"
            {...form.getInputProps('title')}
          />
          <Textarea
            label="Event Description"
            withAsterisk
            placeholder="Event description"
            {...form.getInputProps('description')}
          />
          <DateTimePicker
            label="Start Date"
            withAsterisk
            valueFormat="MM-DD-YYYY h:mm A [Urbana Time]"
            placeholder="Pick start date"
            {...form.getInputProps('start')}
          />
          <DateTimePicker
            label="End Date"
            withAsterisk
            valueFormat="MM-DD-YYYY h:mm A [Urbana Time]"
            placeholder="Pick end date (optional)"
            {...form.getInputProps('end')}
          />
          <TextInput
            label="Event Location"
            withAsterisk
            placeholder="ACM Room"
            {...form.getInputProps('location')}
          />
          <TextInput
            label="Location Link"
            placeholder="Google Maps link for location"
            {...form.getInputProps('locationLink')}
          />
          <Select
            label="Host"
            placeholder="Select host organization"
            withAsterisk
            data={orgList.map((org) => ({ value: org, label: org }))}
            {...form.getInputProps('host')}
          />
          <Switch
            label={`Show on home page carousel${!form.values.repeats ? ' and Discord' : ''}?`}
            style={{ paddingTop: '0.5em' }}
            {...form.getInputProps('featured', { type: 'checkbox' })}
          />
          <Select
            label="Repeats"
            placeholder="Select repeat frequency"
            data={repeatOptions.map((option) => ({
              value: option,
              label: capitalizeFirstLetter(option),
            }))}
            clearable
            {...form.getInputProps('repeats')}
          />
          {form.values.repeats && (
            <DateTimePicker
              valueFormat="MM-DD-YYYY h:mm A [Urbana Time]"
              label="Repeat Ends"
              placeholder="Pick repeat end date"
              {...form.getInputProps('repeatEnds')}
            />
          )}

          <Group mt="xs">
            <Checkbox
              checked={isPaidEvent === 'ticket'}
              label="Ticket"
              onClick={() => {
                setIsPaidEvent(isPaidEvent === 'ticket' ? undefined : 'ticket');
              }}
            ></Checkbox>
            <Checkbox
              checked={isPaidEvent === 'merch'}
              label="Merch"
              onClick={() => {
                setIsPaidEvent(isPaidEvent === 'merch' ? undefined : 'merch');
              }}
            ></Checkbox>
          </Group>

          {isPaidEvent != undefined && (
            <TextInput
              mt="sm"
              label="Paid Event ID"
              withAsterisk
              placeholder="Enter Ticketing ID or Merch ID prefixed with merch:"
              {...form.getInputProps('paidEventId')}
            />
          )}

          {isPaidEvent == 'ticket' && (
            <Box maw={800} mx="auto" mt="sm">
              <TextInput
                mt="sm"
                label="Event ID"
                withAsterisk
                placeholder="Enter event_id (same as paidEventID):"
                {...form.getInputProps('event_id')}
              />
              <TextInput
                mt="sm"
                label="Event Name"
                withAsterisk
                placeholder="Enter event_name"
                {...form.getInputProps('event_name')}
              />
              <TextInput
                mt="sm"
                label="Event Details"
                withAsterisk
                placeholder="Enter event details"
                {...form.getInputProps('eventDetails')}
              />
              <TextInput
                mt="sm"
                label="Event Image"
                withAsterisk
                placeholder="Enter event image"
                {...form.getInputProps('eventImage')}
              />
              <NumberInput
                mt="sm"
                label="Event Capacity"
                withAsterisk
                placeholder="Enter event capacity"
                {...{
                  ...form.getInputProps('event_capacity'),
                  onChange: (event) =>
                    form.setFieldValue('event_capacity', parseInt(event.toString())),
                }}
              />
              <NumberInput
                mt="sm"
                label="Event Start Sales"
                withAsterisk
                placeholder="Enter event_sales_active_utc"
                {...{
                  ...form.getInputProps('event_sales_active_utc'),
                  onChange: (event) =>
                    form.setFieldValue('event_sales_active_utc', parseInt(event.toString())),
                }}
              />
              <NumberInput
                mt="sm"
                label="Event Time"
                withAsterisk
                placeholder="Enter event_time"
                {...{
                  ...form.getInputProps('event_time'),
                  onChange: (event) => form.setFieldValue('event_time', parseInt(event.toString())),
                }}
              />
              <NumberInput
                mt="sm"
                label="Tickets_sold"
                withAsterisk
                placeholder="Enter Tickets Sold"
                {...{
                  ...form.getInputProps('tickets_sold'),
                  onChange: (event) =>
                    form.setFieldValue('tickets_sold', parseInt(event.toString())),
                }}
              />
            </Box>
          )}
          {isPaidEvent == 'merch' && (
            <Box maw={800} mx="auto" mt="sm">
              <TextInput
                mt="sm"
                label="Item ID"
                withAsterisk
                placeholder="Enter item_id (same as paidEventID):"
                {...form.getInputProps('item_id')}
              />
              <TextInput
                mt="sm"
                label="Item Name"
                withAsterisk
                placeholder="Enter item_name"
                {...form.getInputProps('item_name')}
              />
              <TextInput
                mt="sm"
                label="Items Details"
                withAsterisk
                placeholder="Enter item details"
                {...form.getInputProps('item_email_desc')}
              />
              <TextInput
                mt="sm"
                label="Item Image"
                withAsterisk
                placeholder="Enter item_image"
                {...form.getInputProps('item_image')}
              />

              <NumberInput
                mt="sm"
                label="Item Start Sales"
                withAsterisk
                placeholder="Enter item_sales_active_utc"
                {...{
                  ...form.getInputProps('item_sales_active_utc'),
                  onChange: (event) =>
                    form.setFieldValue('item_sales_active_utc', parseInt(event.toString())),
                }}
              />
              <NumberInput
                mt="sm"
                label="Limit Per Person"
                withAsterisk
                placeholder="Enter limit_per_person"
                {...{
                  ...form.getInputProps('limit_per_person'),
                  onChange: (event) =>
                    form.setFieldValue('limit_per_person', parseInt(event.toString())),
                }}
              />
              <Checkbox
                mt="sm"
                label="PickupStatus"
                placeholder="Click True/False"
                {...form.getInputProps('ready_for_pickup', { type: 'checkbox' })}
              />
            </Box>
          )}
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
