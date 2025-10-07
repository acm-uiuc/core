import { useState, useEffect, ReactNode } from "react";
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
  Checkbox,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { DateInput, DateTimePicker } from "@mantine/dates";
import { AllOrganizationList } from "@acm-uiuc/js-shared";
import {
  eventThemeOptions,
  spaceTypeOptions,
  RoomRequestFormValues,
  RoomRequestPostResponse,
  getSemesters,
  roomRequestSchema,
  specificRoomSetupRooms,
} from "@common/types/roomRequest";
import { useNavigate } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { fromError } from "zod-validation-error";
import { ZodError } from "zod/v4";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import { useAuth } from "@ui/components/AuthContext";
import { getPrimarySuggestedOrg } from "@ui/util";

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
  const radioValue = value === undefined ? "" : value === null ? "no" : "yes";

  return (
    <Stack mt="xs">
      <Radio.Group
        label={label}
        description={description}
        withAsterisk={required}
        value={radioValue}
        onChange={(val) => {
          if (val === "no") {
            form.setFieldValue(field, null);
          } else if (val === "yes") {
            if (field === "nonIllinoisAttendees") {
              form.setFieldValue(field, 0);
            } else {
              form.setFieldValue(field, "");
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
  const radioValue = value === undefined ? "" : value === true ? "yes" : "no";

  return (
    <Radio.Group
      label={label}
      description={description}
      mt="md"
      withAsterisk={required}
      value={radioValue}
      onChange={(val) => {
        if (val === "yes") {
          form.setFieldValue(field, true);
        } else if (val === "no") {
          form.setFieldValue(field, false);
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
  createRoomRequest?: (
    payload: RoomRequestFormValues,
  ) => Promise<RoomRequestPostResponse>;
  initialValues?: RoomRequestFormValues;
  viewOnly?: boolean;
}

const recurrencePatternOptions = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
];

const NewRoomRequest: React.FC<NewRoomRequestProps> = ({
  createRoomRequest,
  initialValues,
  viewOnly,
}) => {
  const [active, setActive] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const numSteps = 4;
  const navigate = useNavigate();
  const semesterOptions = getSemesters();
  const { orgRoles } = useAuth();
  const userPrimaryOrg = getPrimarySuggestedOrg(orgRoles);

  // Initialize with today's date and times
  let startingDate = new Date();
  startingDate = new Date(startingDate.setMinutes(0));
  startingDate = new Date(startingDate.setDate(startingDate.getDate() + 1));
  const oneHourAfterStarting = new Date(
    startingDate.getTime() + 60 * 60 * 1000,
  );

  type InterimRoomRequestFormValues = {
    [K in keyof RoomRequestFormValues]: RoomRequestFormValues[K] extends any
      ? RoomRequestFormValues[K] | undefined
      : RoomRequestFormValues[K];
  };

  const form = useForm<InterimRoomRequestFormValues>({
    enhanceGetInputProps: () => ({ readOnly: viewOnly }),
    initialValues:
      initialValues ||
      ({
        host: userPrimaryOrg,
        title: "",
        theme: "",
        semester: semesterOptions[0].value,
        description: "",
        eventStart: startingDate,
        eventEnd: oneHourAfterStarting,
        isRecurring: false,
        recurrencePattern: undefined,
        recurrenceEndDate: undefined,
        setupNeeded: false,
        hostingMinors: undefined,
        locationType: undefined,
        spaceType: "",
        specificRoom: "",
        estimatedAttendees: undefined,
        seatsNeeded: undefined,
        setupDetails: undefined,
        onCampusPartners: undefined,
        offCampusPartners: undefined,
        nonIllinoisSpeaker: undefined,
        nonIllinoisAttendees: undefined,
        foodOrDrink: undefined,
        crafting: undefined,
        comments: "",
      } as InterimRoomRequestFormValues),

    validate: (values) => {
      // Get all validation errors from zod, which returns ReactNode
      const allErrors: Record<string, React.ReactNode> =
        zodResolver(roomRequestSchema)(values);
      // If in view mode, return no errors
      if (viewOnly) {
        return {};
      }

      // Define which fields belong to each step
      const step0Fields = [
        "host",
        "title",
        "theme",
        "semester",
        "description",
        "eventStart",
        "eventEnd",
        "isRecurring",
        "recurrencePattern",
        "recurrenceEndDate",
        "setupNeeded",
        "setupMinutesBefore",
      ];

      const step1Fields = [
        "locationType",
        "hostingMinors",
        "onCampusPartners",
        "offCampusPartners",
        "nonIllinoisSpeaker",
        "nonIllinoisAttendees",
      ];

      const step2Fields = [
        "spaceType",
        "specificRoom",
        "estimatedAttendees",
        "seatsNeeded",
        "setupDetails",
      ];

      const step3Fields = ["foodOrDrink", "crafting", "comments"];

      // Filter errors based on current step
      const currentStepFields =
        active === 0
          ? step0Fields
          : active === 1
            ? step1Fields
            : active === 2
              ? step2Fields
              : active === 3
                ? step3Fields
                : [];

      // Skip Room Requirements validation if the event is virtual
      if (active === 2 && values.locationType === "virtual") {
        return {};
      }

      // Return only errors for the current step
      // Using 'as' to tell TypeScript that we're intentionally returning ReactNode as errors
      const filteredErrors = {} as Record<string, React.ReactNode>;
      for (const key in allErrors) {
        if (currentStepFields.includes(key)) {
          filteredErrors[key] = allErrors[key];
        }
      }
      if (Object.keys(filteredErrors).length > 0) {
        console.warn(filteredErrors);
      }
      return filteredErrors;
    },
  });

  // Check if the room requirements section should be shown
  const showRoomRequirements =
    form.values.locationType === "in-person" ||
    form.values.locationType === "both";

  // Handle clearing field values when conditions change
  useEffect(() => {
    // Clear room requirements data if event is not in-person or hybrid
    if (
      form.values.locationType !== "in-person" &&
      form.values.locationType !== "both"
    ) {
      form.setFieldValue("spaceType", undefined);
      form.setFieldValue("specificRoom", undefined);
      form.setFieldValue("estimatedAttendees", undefined);
      form.setFieldValue("seatsNeeded", undefined);
      form.setFieldValue("setupDetails", undefined);
    }
  }, [form.values.locationType]);

  // Handle clearing recurrence fields if isRecurring is toggled off
  useEffect(() => {
    if (!form.values.isRecurring) {
      form.setFieldValue("recurrencePattern", undefined);
      form.setFieldValue("recurrenceEndDate", undefined);
    }
  }, [form.values.isRecurring]);

  const handleSubmit = async () => {
    if (viewOnly || isSubmitting) {
      return;
    }
    const apiFormValues = { ...form.values };
    Object.keys(apiFormValues).forEach((key) => {
      const value = apiFormValues[key as keyof RoomRequestFormValues];
      if (value === "") {
        console.warn(
          `Empty string found for ${key}. This field should have content.`,
        );
      }
    });
    try {
      if (!createRoomRequest) {
        return;
      }
      setIsSubmitting(true);
      let values;
      try {
        values = await roomRequestSchema.parseAsync(apiFormValues);
      } catch (e) {
        let message = "Check the browser console for more details.";
        if (e instanceof ZodError) {
          message = fromError(e).toString();
        }
        notifications.show({
          title: "Submission failed to validate",
          message,
          color: "red",
        });
        setIsSubmitting(false);
        return;
      }
      const response = await createRoomRequest(values);
      await navigate("/roomRequests");
      notifications.show({
        title: "Room Request Submitted",
        message: `The request ID is ${response.id}.`,
      });
    } catch (e) {
      notifications.show({
        color: "red",
        title: "Failed to submit room request",
        message: "Please try again or contact support.",
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
      if (current === 1 && form.values.locationType === "virtual") {
        return current + 2;
      }

      return current < numSteps ? current + 1 : current;
    });

  const prevStep = () =>
    setActive((current) => {
      // If coming back from step 3 to step 2 and event is virtual, skip Room Requirements step
      if (current === 3 && form.values.locationType === "virtual") {
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
            {...form.getInputProps("semester")}
          />
          <Select
            label="Event Host"
            placeholder="Select host organization"
            withAsterisk
            searchable
            data={AllOrganizationList.map((org) => ({
              value: org,
              label: org,
            }))}
            {...form.getInputProps("host")}
          />
          <TextInput
            label="Event Title"
            withAsterisk
            placeholder="An Amazing Event"
            {...form.getInputProps("title")}
          />
          <Select
            label="Event Theme"
            placeholder="Select event theme"
            withAsterisk
            searchable
            data={eventThemeOptions.map((theme) => ({
              value: theme,
              label: theme,
            }))}
            {...form.getInputProps("theme")}
          />
          <Textarea
            label="Event Description"
            description="Min 10 words. Max 1000 characters."
            withAsterisk
            placeholder="Tell us a bit about your event!"
            {...form.getInputProps("description")}
          />

          <DateTimePicker
            label="Event Start"
            placeholder="Select date and time"
            withAsterisk
            valueFormat="MM-DD-YYYY h:mm A [Urbana Time]"
            mt="sm"
            clearable={false}
            minDate={startingDate}
            {...form.getInputProps("eventStart")}
          />

          <DateTimePicker
            label="Event End"
            placeholder="Select date and time"
            withAsterisk
            valueFormat="MM-DD-YYYY h:mm A [Urbana Time]"
            mt="sm"
            clearable={false}
            minDate={startingDate}
            {...form.getInputProps("eventEnd")}
          />

          <Checkbox
            label="This is a recurring event"
            mt="sm"
            checked={form.values.isRecurring}
            onChange={(event) =>
              form.setFieldValue("isRecurring", event.currentTarget.checked)
            }
          />

          {form.values.isRecurring && (
            <>
              <Select
                label="Recurrence Pattern"
                withAsterisk
                mt="sm"
                data={recurrencePatternOptions}
                placeholder="Select how often this event repeats"
                {...form.getInputProps("recurrencePattern")}
              />

              <DateInput
                label="Recurrence End Date"
                description="The last occurrence will occur on this date (inclusive)."
                withAsterisk
                mt="sm"
                placeholder="When does this recurring event end?"
                minDate={
                  form.values.eventEnd
                    ? new Date(
                        new Date(form.values.eventEnd).setDate(
                          new Date(form.values.eventEnd).getDate(),
                        ),
                      )
                    : new Date()
                }
                {...form.getInputProps("recurrenceEndDate")}
              />
            </>
          )}

          <Checkbox
            label="I need setup time before the event"
            mt="xl"
            checked={form.values.setupNeeded}
            onChange={(event) => {
              form.setFieldValue("setupNeeded", event.currentTarget.checked);
              if (!event.currentTarget.checked) {
                form.setFieldValue("setupMinutesBefore", undefined);
              }
            }}
          />

          {form.values.setupNeeded && (
            <NumberInput
              label="Minutes needed for setup before event"
              description="How many minutes before the event start time do you need access to the room?"
              min={5}
              max={60}
              step={5}
              mt="xs"
              key={form.key("setupMinutesBefore")}
              {...form.getInputProps("setupMinutesBefore")}
            />
          )}
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
            {...form.getInputProps("locationType")}
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
                value={form.values.onCampusPartners || ""}
                onChange={(e) =>
                  form.setFieldValue("onCampusPartners", e.currentTarget.value)
                }
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
                value={form.values.offCampusPartners || ""}
                onChange={(e) =>
                  form.setFieldValue("offCampusPartners", e.currentTarget.value)
                }
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
                value={form.values.nonIllinoisSpeaker || ""}
                onChange={(e) =>
                  form.setFieldValue(
                    "nonIllinoisSpeaker",
                    e.currentTarget.value,
                  )
                }
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
                  typeof form.values.nonIllinoisAttendees === "number"
                    ? form.values.nonIllinoisAttendees
                    : undefined
                }
                onChange={(val) =>
                  form.setFieldValue(
                    "nonIllinoisAttendees",
                    typeof val === "number" ? val : 0,
                  )
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
                Room requirements are only needed for in-person or hybrid
                events.
              </Title>
              <Text mt="sm">
                Please go back and change your event type if this is an
                in-person or hybrid event.
              </Text>
            </Paper>
          ) : (
            <>
              <Radio.Group
                label="What type of space are you requesting?"
                description="* denotes possible additional cost."
                withAsterisk
                {...form.getInputProps("spaceType")}
                onChange={(value) => {
                  form.setFieldValue("setupDetails", undefined);
                  form.setFieldValue("spaceType", value);
                }}
              >
                {spaceTypeOptions.map((option) => (
                  <Radio
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    mt="xs"
                  />
                ))}
              </Radio.Group>

              <Textarea
                mt="md"
                label="Do you have a specific room in mind?"
                description="If not, please list the building or part of campus."
                withAsterisk
                placeholder="Enter specific room or building preferences"
                {...form.getInputProps("specificRoom")}
              />

              <NumberInput
                mt="md"
                label="Estimated number of in-person attendees"
                withAsterisk
                placeholder="Enter estimated attendees"
                min={1}
                {...form.getInputProps("estimatedAttendees")}
              />

              <NumberInput
                mt="md"
                label="Estimated number of seats required"
                withAsterisk
                placeholder="Enter estimated seats required"
                min={1}
                {...form.getInputProps("seatsNeeded")}
              />
              {form.values.spaceType &&
                specificRoomSetupRooms.includes(form.values.spaceType) && (
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
                        value={form.values.setupDetails || ""}
                        onChange={(e) =>
                          form.setFieldValue(
                            "setupDetails",
                            e.currentTarget.value,
                          )
                        }
                        error={form.errors.setupDetails}
                      />
                    }
                  />
                )}
            </>
          )}
        </Stepper.Step>

        <Stepper.Step label="Step 4" description="Miscellaneous Information">
          <YesNoField
            label="Will there be food or drink?"
            field="foodOrDrink"
            form={form}
          />

          <YesNoField
            label="Will there be crafting materials?"
            field="crafting"
            form={form}
          />

          <Textarea
            mt="md"
            label="Comments"
            placeholder="Any questions, comments, or concerns?"
            {...form.getInputProps("comments")}
          />
        </Stepper.Step>
        {!viewOnly && (
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
          (viewOnly && active === numSteps - 1 ? null : (
            <Button onClick={nextStep}>
              {active === numSteps - 1 ? "Review" : "Next"}
            </Button>
          ))}
        {active === numSteps && !viewOnly && (
          <Button onClick={handleSubmit} disabled={isSubmitting} color="green">
            {isSubmitting ? (
              <>
                <Loader size={16} color="white" />
                Submitting...
              </>
            ) : (
              "Submit"
            )}
          </Button>
        )}
      </Group>
    </>
  );
};

export default NewRoomRequest;
