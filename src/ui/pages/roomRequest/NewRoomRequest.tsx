import { useState, useEffect, ReactNode } from 'react';
import {
  Stepper,
  Button,
  Group,
  TextInput,
  Code,
  Select,
  Textarea,
  Radio,
  NumberInput,
  Stack,
  Title,
  Paper,
  Text,
  Loader,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { OrganizationList } from '@common/orgs';
import {
  eventThemeOptions,
  spaceTypeOptions,
  RoomRequestFormValues,
  RoomRequestPostResponse,
  getSemesters,
} from '@common/types/roomRequest';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';

// Component for yes/no questions with conditional content
interface ConditionalFieldProps {
  label: string;
  description?: string;
  field: string;
  form: any; // The form object from useForm
  conditionalContent: ReactNode;
  required?: boolean;
}

const ConditionalField: React.FC<ConditionalFieldProps> = ({
  label,
  description,
  field,
  form,
  conditionalContent,
  required = true,
}) => {
  // Get the current value to determine state
  const value = form.values[field];
  // undefined = unanswered, null = "No", any value = "Yes"
  const radioValue = value === undefined ? '' : value === null ? 'no' : 'yes';

  return (
    <Stack mt="xs">
      <Radio.Group
        label={label}
        description={description}
        withAsterisk={required}
        value={radioValue}
        onChange={(val) => {
          if (val === 'no') {
            form.setFieldValue(field, null);
          } else if (val === 'yes') {
            if (field === 'nonIllinoisAttendees') {
              form.setFieldValue(field, 0);
            } else {
              form.setFieldValue(field, '');
            }
          } else {
            form.setFieldValue(field, undefined);
          }
        }}
        error={form.errors[field]}
      >
        <Group mt="xs">
          <Radio value="yes" label="Yes" />
          <Radio value="no" label="No" />
        </Group>
      </Radio.Group>

      {value !== null && value !== undefined && conditionalContent}
    </Stack>
  );
};

// Component for simple yes/no questions without additional details
interface YesNoFieldProps {
  label: string;
  description?: string;
  field: string;
  form: any;
  required?: boolean;
}

const YesNoField: React.FC<YesNoFieldProps> = ({
  label,
  description,
  field,
  form,
  required = true,
}) => {
  const value = form.values[field];
  const radioValue = value === undefined ? '' : value === true ? 'yes' : 'no';

  return (
    <Radio.Group
      label={label}
      description={description}
      mt="md"
      withAsterisk={required}
      value={radioValue}
      onChange={(val) => {
        if (val === 'yes') {
          form.setFieldValue(field, true);
        } else if (val === 'no') {
          form.setFieldValue(field, null);
        } else {
          form.setFieldValue(field, undefined);
        }
      }}
      error={form.errors[field]}
    >
      <Group mt="xs">
        <Radio value="yes" label="Yes" />
        <Radio value="no" label="No" />
      </Group>
    </Radio.Group>
  );
};

interface NewRoomRequestProps {
  createRoomRequest?: (payload: RoomRequestFormValues) => Promise<RoomRequestPostResponse>;
  initialValues?: RoomRequestFormValues;
  disabled?: boolean;
}

const NewRoomRequest: React.FC<NewRoomRequestProps> = ({
  createRoomRequest,
  initialValues,
  disabled,
}) => {
  const [active, setActive] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const numSteps = 4;
  const navigate = useNavigate();
  const semesterOptions = getSemesters();
  const semesterValues = semesterOptions.map((x) => x.value);

  const form = useForm<RoomRequestFormValues>({
    enhanceGetInputProps: () => ({ readOnly: disabled }),
    initialValues: initialValues || {
      host: '',
      title: '',
      theme: '',
      semester: '',
      description: '',
      hostingMinors: undefined,
      locationType: 'in-person',
      spaceType: '',
      specificRoom: '',
      estimatedAttendees: undefined,
      seatsNeeded: undefined,
      setupDetails: undefined,
      onCampusPartners: undefined,
      offCampusPartners: undefined,
      nonIllinoisSpeaker: undefined,
      nonIllinoisAttendees: undefined,
      foodOrDrink: undefined,
      crafting: undefined,
      comments: '',
    },

    validate: (values) => {
      if (disabled) {
        return {};
      }
      if (active === 0) {
        return {
          host: OrganizationList.includes(values.host) ? null : 'Invalid organization selected.',
          title: values.title.length > 1 ? null : 'Title cannot be blank.',
          theme: eventThemeOptions.includes(values.theme) ? null : 'Invalid theme selected.',
          description:
            values.description.split(' ').length >= 10
              ? values.description.length <= 1000
                ? null
                : 'Your description is too long.'
              : 'At least 10 words are required.',
          semester: semesterValues.includes(values.semester) ? null : 'Invalid semester selected.',
        };
      }

      if (active === 1) {
        const errors: Record<string, string | null> = {
          locationType: values.locationType ? null : 'You must select an option.',
          hostingMinors: values.hostingMinors !== undefined ? null : 'Please select an option.',
          onCampusPartners:
            values.onCampusPartners !== undefined ? null : 'Please select an option.',
          offCampusPartners:
            values.offCampusPartners !== undefined ? null : 'Please select an option.',
          nonIllinoisSpeaker:
            values.nonIllinoisSpeaker !== undefined ? null : 'Please select an option.',
          nonIllinoisAttendees:
            values.nonIllinoisAttendees !== undefined ? null : 'Please select an option.',
        };

        // Check if conditional fields have values when they should
        if (values.onCampusPartners === '') {
          errors.onCampusPartners = 'Please provide details about on-campus partners.';
        }

        if (values.offCampusPartners === '') {
          errors.offCampusPartners = 'Please provide details about off-campus partners.';
        }

        if (values.nonIllinoisSpeaker === '') {
          errors.nonIllinoisSpeaker = 'Please provide details about non-UIUC speakers.';
        }

        if (values.nonIllinoisAttendees === 0) {
          errors.nonIllinoisAttendees = 'Percentage must be greater than 0.';
        }

        return errors;
      }

      if (active === 2 && (values.locationType === 'in-person' || values.locationType === 'both')) {
        const errors: Record<string, string | null> = {
          spaceType:
            values.spaceType && values.spaceType.length > 0 ? null : 'Please select a space type.',
          specificRoom:
            values.specificRoom && values.specificRoom?.length > 0
              ? null
              : 'Please provide details about the room location.',
          estimatedAttendees:
            values.estimatedAttendees && values.estimatedAttendees > 0
              ? null
              : 'Please provide an estimated number of attendees.',
          seatsNeeded:
            values.seatsNeeded && values.seatsNeeded > 0
              ? !values.estimatedAttendees || values.seatsNeeded >= values.estimatedAttendees
                ? null
                : 'Number of seats must be greater than or equal to number of attendees.'
              : 'Please specify how many seats you need.',
          setupDetails: values.setupDetails !== undefined ? null : 'Please make a selection.',
        };

        if (values.setupDetails === '') {
          errors.setupDetails = 'Please provide setup details.';
        }

        return errors;
      }

      if (active === 3) {
        return {
          foodOrDrink: values.foodOrDrink !== undefined ? null : 'You must select an option.',
          crafting: values.crafting !== undefined ? null : 'You must select an option.',
        };
      }

      return {};
    },
  });

  // Check if the room requirements section should be shown
  const showRoomRequirements =
    form.values.locationType === 'in-person' || form.values.locationType === 'both';

  // Handle clearing field values when conditions change
  useEffect(() => {
    // Clear room requirements data if event is not in-person or hybrid
    if (form.values.locationType !== 'in-person' && form.values.locationType !== 'both') {
      form.setFieldValue('spaceType', undefined);
      form.setFieldValue('specificRoom', undefined);
      form.setFieldValue('estimatedAttendees', undefined);
      form.setFieldValue('seatsNeeded', undefined);
      form.setFieldValue('setupDetails', undefined);
    }
  }, [form.values.locationType]);

  const handleSubmit = async () => {
    if (disabled) {
      return;
    }
    const apiFormValues = { ...form.values };
    Object.keys(apiFormValues).forEach((key) => {
      const value = apiFormValues[key as keyof RoomRequestFormValues];
      if (value === '') {
        console.warn(`Empty string found for ${key}. This field should have content.`);
      }
    });
    try {
      if (!createRoomRequest) {
        return;
      }
      setIsSubmitting(true);
      const response = await createRoomRequest(apiFormValues);
      notifications.show({
        title: 'Room Request Submitted',
        message: `The request ID is ${response.id}.`,
      });
      setIsSubmitting(false);
      navigate('/roomRequests');
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Failed to submit room request',
        message: 'Please try again or contact support.',
      });
      setIsSubmitting(false);
      throw e;
    }
  };

  const nextStep = () =>
    setActive((current) => {
      if (form.validate().hasErrors) {
        return current;
      }

      // Skip Room Requirements step if the event is virtual only
      if (current === 1 && form.values.locationType === 'virtual') {
        return current + 2;
      }

      return current < numSteps ? current + 1 : current;
    });

  const prevStep = () =>
    setActive((current) => {
      // If coming back from step 3 to step 2 and event is virtual, skip Room Requirements step
      if (current === 3 && form.values.locationType === 'virtual') {
        return current - 2;
      }
      return current > 0 ? current - 1 : current;
    });

  return (
    <>
      <Stepper active={active}>
        <Stepper.Step label="Step 1" description="Basic Information">
          <Select
            label="Semester"
            placeholder="Select event semester"
            withAsterisk
            searchable
            data={semesterOptions}
            {...form.getInputProps('semester')}
          />
          <Select
            label="Event Host"
            placeholder="Select host organization"
            withAsterisk
            searchable
            data={OrganizationList.map((org) => ({ value: org, label: org }))}
            {...form.getInputProps('host')}
          />
          <TextInput
            label="Event Title"
            withAsterisk
            placeholder="An Amazing Event"
            {...form.getInputProps('title')}
          />
          <Select
            label="Event Theme"
            placeholder="Select event theme"
            withAsterisk
            searchable
            data={eventThemeOptions.map((theme) => ({ value: theme, label: theme }))}
            {...form.getInputProps('theme')}
          />
          <Textarea
            label="Event Description"
            description="Min 10 words. Max 1000 characters."
            withAsterisk
            placeholder="Tell us a bit about your event!"
            {...form.getInputProps('description')}
          />
        </Stepper.Step>

        <Stepper.Step label="Step 2" description="Compliance Information">
          <YesNoField
            label="Are you hosting anyone under 18 whom is not affiliated with the University of Illinois?"
            field="hostingMinors"
            form={form}
          />

          <Radio.Group
            label="What medium will this event be hosted in?"
            mt="md"
            withAsterisk
            {...form.getInputProps('locationType')}
          >
            <Group mt="xs">
              <Radio value="in-person" label="In Person" />
              <Radio value="virtual" label="Virtual" />
              <Radio value="both" label="Both In-Person and Virtual" />
            </Group>
          </Radio.Group>

          <ConditionalField
            label="Are you partnering with any on-campus entities? (RSOs, Departments, Programs, Centers, etc.)"
            description="Do not include ACM @ UIUC."
            field="onCampusPartners"
            form={form}
            conditionalContent={
              <Textarea
                mt="xs"
                label="Please list all on-campus partners"
                withAsterisk
                placeholder="List all on-campus partners for this event"
                value={form.values.onCampusPartners || ''}
                onChange={(e) => form.setFieldValue('onCampusPartners', e.currentTarget.value)}
                error={form.errors.onCampusPartners}
              />
            }
          />

          <ConditionalField
            label="Are you partnering with any off-campus entities?"
            description="Off-campus entities generally refers to anyone not directly affiliated with UIUC."
            field="offCampusPartners"
            form={form}
            conditionalContent={
              <Textarea
                mt="xs"
                label="Please list all off-campus partners"
                withAsterisk
                placeholder="List all off-campus partners for this event"
                value={form.values.offCampusPartners || ''}
                onChange={(e) => form.setFieldValue('offCampusPartners', e.currentTarget.value)}
                error={form.errors.offCampusPartners}
              />
            }
          />

          <ConditionalField
            label="Will there be a non-UIUC affiliated speaker/performer at your event?"
            field="nonIllinoisSpeaker"
            form={form}
            conditionalContent={
              <Textarea
                mt="xs"
                label="Non-UIUC Speaker/Performer Details"
                description="Please list on which dates the speaker/performer will be attending."
                withAsterisk
                placeholder="Please list on which dates the speaker/performer will be attending."
                value={form.values.nonIllinoisSpeaker || ''}
                onChange={(e) => form.setFieldValue('nonIllinoisSpeaker', e.currentTarget.value)}
                error={form.errors.nonIllinoisSpeaker}
              />
            }
          />

          <ConditionalField
            label="Will you have any non-UIUC attendees?"
            field="nonIllinoisAttendees"
            form={form}
            conditionalContent={
              <NumberInput
                label="Estimated Percent of non-UIUC Attendees"
                withAsterisk
                placeholder="Percent"
                suffix="%"
                min={1}
                max={100}
                mt="xs"
                value={
                  typeof form.values.nonIllinoisAttendees === 'number'
                    ? form.values.nonIllinoisAttendees
                    : undefined
                }
                onChange={(val) =>
                  form.setFieldValue('nonIllinoisAttendees', typeof val === 'number' ? val : 0)
                }
                error={form.errors.nonIllinoisAttendees}
              />
            }
          />
        </Stepper.Step>

        <Stepper.Step label="Step 3" description="Room Requirements">
          {!showRoomRequirements ? (
            <Paper p="md" withBorder>
              <Title order={4}>
                Room requirements are only needed for in-person or hybrid events.
              </Title>
              <Text mt="sm">
                Please go back and change your event type if this is an in-person or hybrid event.
              </Text>
            </Paper>
          ) : (
            <>
              <Radio.Group
                label="What type of space are you requesting?"
                description="* denotes possible additional cost."
                withAsterisk
                {...form.getInputProps('spaceType')}
              >
                {spaceTypeOptions.map((option) => (
                  <Radio key={option.value} value={option.value} label={option.label} mt="xs" />
                ))}
              </Radio.Group>

              <Textarea
                mt="md"
                label="Do you have a specific room in mind?"
                description="If not, please list the building or part of campus."
                withAsterisk
                placeholder="Enter specific room or building preferences"
                {...form.getInputProps('specificRoom')}
              />

              <NumberInput
                mt="md"
                label="Estimated number of attendees"
                withAsterisk
                placeholder="Enter estimated attendees"
                min={1}
                {...form.getInputProps('estimatedAttendees')}
              />

              <NumberInput
                mt="md"
                label="Estimated number of seats required"
                withAsterisk
                placeholder="Enter estimated seats required"
                min={1}
                {...form.getInputProps('seatsNeeded')}
              />

              <ConditionalField
                label="Do you require a specific room setup?"
                description="Only available for Illini Union, Campus Rec, and Performance Spaces"
                field="setupDetails"
                form={form}
                conditionalContent={
                  <Textarea
                    mt="xs"
                    label="Setup Details"
                    description="Please describe the specific setup requirements you need."
                    withAsterisk
                    placeholder="Describe your setup requirements"
                    value={form.values.setupDetails || ''}
                    onChange={(e) => form.setFieldValue('setupDetails', e.currentTarget.value)}
                    error={form.errors.setupDetails}
                  />
                }
              />
            </>
          )}
        </Stepper.Step>

        <Stepper.Step label="Step 4" description="Miscellaneous Information">
          <YesNoField label="Will there be food or drink?" field="foodOrDrink" form={form} />

          <YesNoField label="Will there be crafting materials?" field="crafting" form={form} />

          <Textarea
            mt="md"
            label="Comments"
            placeholder="Any questions, comments, or concerns?"
            {...form.getInputProps('comments')}
          />
        </Stepper.Step>
        {!disabled && (
          <Stepper.Completed>
            Click the Submit button to submit the following room request:
            <Code block mt="xl">
              {JSON.stringify(form.values, null, 2)}
            </Code>
          </Stepper.Completed>
        )}
      </Stepper>
      <Group justify="flex-end" mt="xl">
        {active !== 0 && (
          <Button variant="default" onClick={prevStep}>
            Back
          </Button>
        )}
        {active !== numSteps &&
          (disabled && active === numSteps - 1 ? null : (
            <Button onClick={nextStep}>{active === numSteps - 1 ? 'Review' : 'Next'}</Button>
          ))}
        {active === numSteps && !disabled && (
          <Button onClick={handleSubmit} color="green">
            {isSubmitting ? (
              <>
                <Loader size={16} color="white" />
                Submitting...
              </>
            ) : (
              'Submit'
            )}
          </Button>
        )}
      </Group>
    </>
  );
};

export default NewRoomRequest;
