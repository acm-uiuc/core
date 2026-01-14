import { FastifyPluginAsync } from "fastify";
import {
  QueryCommand,
  QueryCommandInput,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { genericConfig } from "../../common/config.js";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { NotFoundError } from "../../common/errors/index.js";
import ical, {
  ICalCalendarMethod,
  ICalEventJSONRepeatingData,
  ICalEventRepeatingFreq,
} from "ical-generator";
import { getVtimezoneComponent } from "@touch4it/ical-timezones";
import {
  AllOrganizationNameList,
  getOrgIdByName,
  OrganizationId,
  Organizations,
} from "@acm-uiuc/js-shared";
import { CLIENT_HTTP_CACHE_POLICY, EventRepeatOptions } from "./events.js";
import rateLimiter from "api/plugins/rateLimiter.js";
import { getCacheCounter } from "api/functions/cache.js";
import {
  FastifyZodOpenApiSchema,
  FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import { acmCoreOrganization, withTags } from "api/components/index.js";
import * as z from "zod/v4";
import {
  applyTimeFromReferenceAsLocal,
  parseAsLocalDate,
} from "common/time.js";
import { DEFAULT_TIMEZONE } from "common/constants.js";

const repeatingIcalMap: Record<EventRepeatOptions, ICalEventJSONRepeatingData> =
  {
    weekly: { freq: ICalEventRepeatingFreq.WEEKLY },
    biweekly: { freq: ICalEventRepeatingFreq.WEEKLY, interval: 2 },
  };

function generateHostName(host: string) {
  if (host === "ACM" || !host) {
    return "ACM@UIUC";
  }
  if (host.includes("ACM")) {
    return host;
  }
  return `ACM@UIUC ${host}`;
}

const normalizeEventHost = (host: string): string => {
  return Organizations[host as OrganizationId]?.name || host;
};

const icalPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.register(rateLimiter, {
    limit: AllOrganizationNameList.length,
    duration: 30,
    rateLimitIdentifier: "ical",
  });
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().get(
    "/:host?",
    {
      schema: withTags(["iCalendar Integration"], {
        params: z.object({
          host: z.optional(acmCoreOrganization).meta({
            description: "Organization to retrieve calendar for",
          }),
        }),
        summary:
          "Retrieve the calendar for ACM @ UIUC or a specific sub-organization.",
      } satisfies FastifyZodOpenApiSchema),
    },
    async (request, reply) => {
      const host = request.params.host;
      let queryParams: QueryCommandInput = {
        TableName: genericConfig.EventsDynamoTableName,
      };
      let response;
      const ifNoneMatch = request.headers["if-none-match"];
      if (ifNoneMatch) {
        const etag = await getCacheCounter(
          fastify.dynamoClient,
          `events-etag-${host || "all"}`,
        );

        if (
          ifNoneMatch === `"${etag.toString()}"` ||
          ifNoneMatch === etag.toString()
        ) {
          return reply
            .code(304)
            .header("ETag", etag)
            .header("Cache-Control", CLIENT_HTTP_CACHE_POLICY)
            .send();
        }

        reply.header("etag", etag);
      }
      if (host) {
        queryParams = {
          ...queryParams,
        };
        response = await fastify.dynamoClient.send(
          new QueryCommand({
            ...queryParams,
            ExpressionAttributeValues: {
              ":host": {
                S: getOrgIdByName(host),
              },
            },
            KeyConditionExpression: "host = :host",
            IndexName: "HostIndex",
          }),
        );
      } else {
        response = await fastify.dynamoClient.send(
          new ScanCommand(queryParams),
        );
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
      if (host === "ACM") {
        calendarName = "ACM@UIUC - Major Events";
      }
      if (!host) {
        calendarName = "ACM@UIUC - All Events";
      }
      const calendar = ical({ name: calendarName });
      calendar.timezone({
        name: DEFAULT_TIMEZONE,
        generator: getVtimezoneComponent,
      });
      calendar.method(ICalCalendarMethod.PUBLISH);
      for (const rawEvent of dynamoItems) {
        const startDate = parseAsLocalDate(rawEvent.start, DEFAULT_TIMEZONE);
        const endDate = rawEvent.end
          ? parseAsLocalDate(rawEvent.end, DEFAULT_TIMEZONE)
          : parseAsLocalDate(rawEvent.start, DEFAULT_TIMEZONE);

        let event = calendar.createEvent({
          start: startDate,
          end: endDate,
          summary: rawEvent.title,
          description: rawEvent.locationLink
            ? `Host: ${normalizeEventHost(rawEvent.host)}\nGoogle Maps Link: ${rawEvent.locationLink}\n\n${rawEvent.description}`
            : `Host: ${normalizeEventHost(rawEvent.host)}\n\n${rawEvent.description}`,
          timezone: DEFAULT_TIMEZONE,
          organizer: generateHostName(host || "ACM"),
          id: rawEvent.id,
        });

        if (rawEvent.repeats) {
          const exclusions = ((rawEvent.repeatExcludes as string[]) || []).map(
            (x) =>
              applyTimeFromReferenceAsLocal(
                x,
                rawEvent.start,
                DEFAULT_TIMEZONE,
              ),
          );

          if (rawEvent.repeatEnds) {
            event = event.repeating({
              ...repeatingIcalMap[rawEvent.repeats as EventRepeatOptions],
              until: parseAsLocalDate(rawEvent.repeatEnds, DEFAULT_TIMEZONE),
              ...(exclusions.length > 0 && { exclude: exclusions }),
            });
          } else {
            event.repeating({
              ...repeatingIcalMap[rawEvent.repeats as EventRepeatOptions],
              ...(exclusions.length > 0 && { exclude: exclusions }),
            });
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
    },
  );
};

export default icalPlugin;
