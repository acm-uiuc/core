import { FastifyPluginAsync } from "fastify";
import {
  DynamoDBClient,
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { NotFoundError, ValidationError } from "../../common/errors/index.js";
import ical, {
  ICalCalendarMethod,
  ICalEventJSONRepeatingData,
  ICalEventRepeatingFreq,
} from "ical-generator";
import moment from "moment";
import { getVtimezoneComponent } from "@touch4it/ical-timezones";
import { OrganizationList } from "../../common/orgs.js";
import { EventRepeatOptions } from "./events.js";

const dynamoClient = new DynamoDBClient({
  region: genericConfig.AwsRegion,
});

const repeatingIcalMap: Record<EventRepeatOptions, ICalEventJSONRepeatingData> =
  {
    weekly: { freq: ICalEventRepeatingFreq.WEEKLY },
    biweekly: { freq: ICalEventRepeatingFreq.WEEKLY, interval: 2 },
  };

function generateHostName(host: string) {
  if (host == "ACM" || !host) {
    return "ACM@UIUC";
  }
  if (host.includes("ACM")) {
    return host;
  }
  return `ACM@UIUC ${host}`;
}

const icalPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get("/:host?", async (request, reply) => {
    const host = (request.params as Record<string, string>).host;
    let queryParams: QueryCommandInput = {
      TableName: genericConfig.EventsDynamoTableName,
    };
    let response;
    if (host) {
      if (!OrganizationList.includes(host)) {
        throw new ValidationError({
          message: `Invalid host parameter "${host}" in path.`,
        });
      }
      queryParams = {
        ...queryParams,
      };
      response = await dynamoClient.send(
        new QueryCommand({
          ...queryParams,
          ExpressionAttributeValues: {
            ":host": {
              S: host,
            },
          },
          KeyConditionExpression: "host = :host",
          IndexName: "HostIndex",
        }),
      );
    } else {
      response = await dynamoClient.send(new ScanCommand(queryParams));
    }
    const dynamoItems = response.Items
      ? response.Items.map((x) => unmarshall(x))
      : null;
    if (!dynamoItems) {
      throw new NotFoundError({
        endpointName: host ? `/api/v1/ical/${host}` : "/api/v1/ical",
      });
    }
    // generate friendly calendar name
    let calendarName =
      host && host.includes("ACM")
        ? `${host} Events`
        : `ACM@UIUC - ${host} Events`;
    if (host == "ACM") {
      calendarName = "ACM@UIUC - Major Events";
    }
    if (!host) {
      calendarName = "ACM@UIUC - All Events";
    }
    const calendar = ical({ name: calendarName });
    calendar.timezone({
      name: "America/Chicago",
      generator: getVtimezoneComponent,
    });
    calendar.method(ICalCalendarMethod.PUBLISH);
    for (const rawEvent of dynamoItems) {
      let event = calendar.createEvent({
        start: moment.tz(rawEvent.start, "America/Chicago"),
        end: rawEvent.end
          ? moment.tz(rawEvent.end, "America/Chicago")
          : moment.tz(rawEvent.start, "America/Chicago"),
        summary: rawEvent.title,
        description: rawEvent.locationLink
          ? `Host: ${rawEvent.host}\nGoogle Maps Link: ${rawEvent.locationLink}\n\n` +
            rawEvent.description
          : `Host: ${rawEvent.host}\n\n` + rawEvent.description,
        timezone: "America/Chicago",
        organizer: generateHostName(host),
        id: rawEvent.id,
      });

      if (rawEvent.repeats) {
        if (rawEvent.repeatEnds) {
          event = event.repeating({
            ...repeatingIcalMap[rawEvent.repeats as EventRepeatOptions],
            until: moment.tz(rawEvent.repeatEnds, "America/Chicago"),
          });
        } else {
          event.repeating(
            repeatingIcalMap[rawEvent.repeats as EventRepeatOptions],
          );
        }
      }
      if (rawEvent.location) {
        event = event.location({
          title: rawEvent.location,
        });
      }
    }

    reply
      .headers({
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="calendar.ics"',
      })
      .send(calendar.toString());
  });
};

export default icalPlugin;