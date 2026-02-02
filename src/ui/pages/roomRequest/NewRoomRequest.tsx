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
  Alert,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { DateInput } from "@mantine/dates";
import { Organizations } from "@acm-uiuc/js-shared";
import {
  eventThemeOptions,
  spaceTypeOptions,
  RoomRequestFormValues,
  RoomRequestPostResponse,
  getSemesters,
  roomRequestSchema,
  specificRoomSetupRooms,
  getSemesterDateRange,
  RoomRequestGetResponse,
  roomRequestCompatShim,
  roomRequestDataSchema,
} from "@common/types/roomRequest";
import { useNavigate } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { fromError } from "zod-validation-error";
import { ZodError } from "zod/v4";
import { zod4Resolver as zodResolver } from "mantine-form-zod-resolver";
import { useAuth } from "@ui/components/AuthContext";
import { getPrimarySuggestedOrg } from "@ui/util";
import { IconInfoCircle } from "@tabler/icons-react";
import {
  UrbanaDateTimePicker,
  formatChicagoTime,
  utcUnixToChicagoDisplayDate,
} from "@ui/components/UrbanaDateTimePicker";
import { isInDefaultTimezone } from "@common/time";
import { NonUrbanaTimezoneAlert } from "@ui/components/NonUrbanaTimezoneAlert";

const getEffectiveMinDate = (
  semester: string | undefined,
  fallbackDate: Date,
): Date => {
  const semesterRange = getSemesterDateRange(semester);
  if (!semesterRange) {
    return fallbackDate;
  }

  return semesterRange.start > fallbackDate
    ? semesterRange.start
    : fallbackDate;
};

const getEffectiveMaxDate = (
  semester: string | undefined,
): Date | undefined => {
  const semesterRange = getSemesterDateRange(semester);
  return semesterRange?.end;
};

// Component for yes/no questions with conditional content
interface ConditionalFieldProps {
  label: string;
  description?: string;
  field: string;
  form: any;
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
  const value = form.values[field];
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
  initialValues?: RoomRequestGetResponse["data"];
  viewOnly?: boolean;
}

const recurrencePatternOptions = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
];

// Convert Date to unix timestamp (seconds)
const dateToUnix = (date: Date | string): number => {
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.floor(d.getTime() / 1000);
};

// Convert unix timestamp to Date
const unixToDate = (unix: number | undefined): Date | undefined => {
  if (unix == null) {
    return undefined;
  }
  return new Date(unix * 1000);
};

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

  // Initialize with tomorrow's date at the start of the hour
  let startingDate = new Date();
  startingDate = new Date(startingDate.setMinutes(0, 0, 0));
  startingDate = new Date(startingDate.setDate(startingDate.getDate() + 1));
  const oneHourAfterStarting = new Date(
    startingDate.getTime() + 60 * 60 * 1000,
  );

  // Convert initial dates to unix timestamps
  const initialEventStart = initialValues?.eventStart
    ? dateToUnix(initialValues.eventStart)
    : dateToUnix(startingDate);
  const initialEventEnd = initialValues?.eventEnd
    ? dateToUnix(initialValues.eventEnd)
    : dateToUnix(oneHourAfterStarting);
  const initialRecurrenceEndDate = initialValues?.recurrenceEndDate
    ? dateToUnix(initialValues.recurrenceEndDate)
    : undefined;

  type InterimRoomRequestFormValues = {
    [K in keyof Omit<
      RoomRequestFormValues,
      "eventStart" | "eventEnd" | "recurrenceEndDate" | "requestsSccsRoom"
    >]: RoomRequestFormValues[K] extends any
      ? RoomRequestFormValues[K] | undefined
      : RoomRequestFormValues[K];
  } & {
    eventStart: number | undefined;
    eventEnd: number | undefined;
    recurrenceEndDate: number | undefined;
    requestsSccsRoom?: boolean | undefined;
  };

  const form = useForm<InterimRoomRequestFormValues>({
    enhanceGetInputProps: () => ({ readOnly: viewOnly }),
    initialValues: initialValues
      ? {
          ...initialValues,
          eventStart: initialEventStart,
          eventEnd: initialEventEnd,
          recurrenceEndDate: initialRecurrenceEndDate,
        }
      : ({
          host: userPrimaryOrg,
          title: "",
          theme: "",
          semester: semesterOptions[0].value,
          description: "",
          eventStart: initialEventStart,
          eventEnd: initialEventEnd,
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
          requestsSccsRoom: undefined,
        } as InterimRoomRequestFormValues),

    validate: (values) => {
      // Convert unix timestamps back to Dates for validation
      const valuesForValidation = {
        ...values,
        eventStart: unixToDate(values.eventStart),
        eventEnd: unixToDate(values.eventEnd),
        recurrenceEndDate: unixToDate(values.recurrenceEndDate),
      };
      const schema = viewOnly
        ? roomRequestDataSchema.extend(roomRequestCompatShim)
        : roomRequestDataSchema;
      const allErrors: Record<string, React.ReactNode> =
        zodResolver(schema)(valuesForValidation);

      if (viewOnly) {
        return {};
      }

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
        "requestsSccsRoom",
      ];

      const step3Fields = ["foodOrDrink", "crafting", "comments"];

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

      if (active === 2 && values.locationType === "virtual") {
        return {};
      }

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

  // Compute semester date constraints
  const semesterMinDate = getEffectiveMinDate(
    form.values.semester,
    startingDate,
  );
  const semesterMaxDate = getEffectiveMaxDate(form.values.semester);

  const showRoomRequirements =
    form.values.locationType === "in-person" ||
    form.values.locationType === "both";

  useEffect(() => {
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

    // Convert unix timestamps back to Dates for API submission
    const apiFormValues = {
      ...form.values,
      eventStart: unixToDate(form.values.eventStart),
      eventEnd: unixToDate(form.values.eventEnd),
      recurrenceEndDate: unixToDate(form.values.recurrenceEndDate),
    };

    Object.keys(apiFormValues).forEach((key) => {
      const value = apiFormValues[key as keyof typeof apiFormValues];
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
      navigate(`/roomRequests/${values.semester}/${response.id}`);
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

      if (current === 1 && form.values.locationType === "virtual") {
        return current + 2;
      }

      return current < numSteps ? current + 1 : current;
    });

  const prevStep = () =>
    setActive((current) => {
      if (current === 3 && form.values.locationType === "virtual") {
        return current - 2;
      }
      return current > 0 ? current - 1 : current;
    });

  return (
    <>
      <NonUrbanaTimezoneAlert />
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
            data={orgRoles
              .filter((x) => x.role === "LEAD")
              .map((x) => ({
                value: x.org,
                label: Organizations[x.org].name,
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

          <UrbanaDateTimePicker
            label="Event Start"
            placeholder="Select date and time"
            withAsterisk
            valueFormat="MM-DD-YYYY hh:mm A [CT]"
            mt="sm"
            clearable={false}
            minDate={semesterMinDate}
            maxDate={semesterMaxDate}
            timePickerProps={{
              withDropdown: true,
              popoverProps: { withinPortal: false },
              format: "12h",
            }}
            firstDayOfWeek={0}
            value={form.values.eventStart}
            onChange={(value) =>
              viewOnly ? undefined : form.setFieldValue("eventStart", value)
            }
            error={form.errors.eventStart}
          />

          <UrbanaDateTimePicker
            label="Event End"
            placeholder="Select date and time"
            withAsterisk
            valueFormat="MM-DD-YYYY hh:mm A [CT]"
            mt="sm"
            clearable={false}
            minDate={semesterMinDate}
            maxDate={semesterMaxDate}
            timePickerProps={{
              withDropdown: true,
              popoverProps: { withinPortal: false },
              format: "12h",
            }}
            firstDayOfWeek={0}
            value={form.values.eventEnd}
            onChange={(value) =>
              viewOnly ? undefined : form.setFieldValue("eventEnd", value)
            }
            error={form.errors.eventEnd}
          />

          <Checkbox
            label="This is a recurring event"
            mt="sm"
            checked={form.values.isRecurring}
            onChange={(event) =>
              viewOnly
                ? undefined
                : form.setFieldValue("isRecurring", event.currentTarget.checked)
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
                    ? new Date(form.values.eventEnd * 1000)
                    : semesterMinDate
                }
                maxDate={semesterMaxDate}
                value={unixToDate(form.values.recurrenceEndDate) ?? null}
                onChange={(date) =>
                  viewOnly
                    ? undefined
                    : form.setFieldValue(
                        "recurrenceEndDate",
                        date ? dateToUnix(date) : undefined,
                      )
                }
                error={form.errors.recurrenceEndDate}
              />
            </>
          )}

          <Checkbox
            label="I need setup time before the event"
            mt="xl"
            checked={form.values.setupNeeded}
            onChange={(event) => {
              if (!viewOnly) {
                form.setFieldValue("setupNeeded", event.currentTarget.checked);
                if (!event.currentTarget.checked) {
                  form.setFieldValue("setupMinutesBefore", undefined);
                }
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
              {viewOnly && !form.values.requestsSccsRoom ? null : (
                <YesNoField
                  label="Are you requesting a room in the Siebel Center for Computer Science?"
                  description={`You MUST select "Yes" if applicable to ensure SCCS F&S can look at your request.`}
                  field="requestsSccsRoom"
                  form={form}
                />
              )}

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
              {JSON.stringify(
                {
                  ...form.values,
                  eventStart: formatChicagoTime(form.values.eventStart),
                  eventEnd: formatChicagoTime(form.values.eventEnd),
                  recurrenceEndDate: formatChicagoTime(
                    form.values.recurrenceEndDate,
                  ),
                },
                null,
                2,
              )}
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
