import {
  Client,
  GatewayIntentBits,
  Events,
  type GuildScheduledEventCreateOptions, // Use this for the payload type
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  DiscordAPIError,
} from "discord.js";
import { type EventPostRequest } from "../routes/events.js";
import moment from "moment-timezone";

import { type FastifyBaseLogger } from "fastify";
import { DiscordEventError } from "../../common/errors/index.js";

export type IUpdateDiscord = EventPostRequest & {
  id: string;
  discordEventId?: string;
};

/**
 * Creates, updates, or deletes a Discord scheduled event directly using its ID.
 * @param config - Bot configuration containing the token and guild ID.
 * @param event - The event data, including an optional discordEventId for updates/deletions.
 * @param actor - The user performing the action, for logging purposes.
 * @param isDelete - A flag to indicate if the event should be deleted.
 * @param logger - The logger instance.
 * @returns The Discord event ID if created/updated, or null if deleted or the operation is skipped.
 */
export const updateDiscord = async (
  config: { botToken: string; guildId: string },
  event: IUpdateDiscord,
  actor: string,
  isDelete: boolean = false,
  logger: FastifyBaseLogger,
): Promise<string | null> => {
  if (!config.botToken) {
    logger.error("No Discord bot token found in secrets!");
    throw new DiscordEventError({
      message: "Discord bot token is not configured.",
    });
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    const result = await new Promise<string | null>((resolve, reject) => {
      client.once(Events.ClientReady, async (readyClient: Client<true>) => {
        logger.debug(`Logged in to Discord as ${readyClient.user.tag}`);
        try {
          const guild = await client.guilds.fetch(config.guildId);

          if (isDelete) {
            if (event.discordEventId) {
              await guild.scheduledEvents.delete(event.discordEventId);
              logger.info(
                `Successfully deleted Discord event ${event.discordEventId}`,
              );
              return resolve(null);
            }
            logger.warn(
              `Cannot delete event with internal ID ${event.id}: no discordEventId was provided.`,
            );
            return resolve(null);
          }

          const { id, title, description, start, end, location, host } = event;
          const dateStart = moment
            .tz(start, "America/Chicago")
            .format("YYYY-MM-DD");
          const calendarURL = `https://www.acm.illinois.edu/calendar?id=${id}&date=${dateStart}`;
          const fullDescription = `${description}\n\nView on ACM Calendar: ${calendarURL}`;
          const fullTitle =
            title.toLowerCase().includes(host.toLowerCase()) || host === "ACM"
              ? title
              : `${host} - ${title}`;

          const payload: GuildScheduledEventCreateOptions = {
            name: fullTitle,
            description: fullDescription,
            scheduledStartTime: moment
              .tz(start, "America/Chicago")
              .utc()
              .toDate(),
            scheduledEndTime: end
              ? moment.tz(end, "America/Chicago").utc().toDate()
              : undefined,
            entityType: GuildScheduledEventEntityType.External,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            entityMetadata: { location },
          };

          if (event.discordEventId) {
            const existingEvent = await guild.scheduledEvents
              .fetch(event.discordEventId)
              .catch(() => null);

            if (!existingEvent) {
              logger.warn(
                `Discord event ${event.discordEventId} not found for update. Attempting to create a new one instead.`,
              );
            } else {
              logger.info(
                `Updating Discord event ${existingEvent.id} for "${title}"`,
              );
              const updatedEvent = await guild.scheduledEvents.edit(
                existingEvent.id,
                {
                  ...payload,
                  reason: `Modified by ${actor}.`,
                },
              );
              return resolve(updatedEvent.id);
            }
          }

          if (payload.scheduledStartTime < new Date()) {
            logger.warn(`Refusing to create past event "${title}"`);
            return resolve(null);
          }

          logger.info(`Creating new Discord event for "${title}"`);
          const newEvent = await guild.scheduledEvents.create({
            ...payload,
            reason: `Created by ${actor}.`,
          });
          return resolve(newEvent.id);
        } catch (error) {
          if (
            error instanceof DiscordAPIError &&
            error.status === 404 &&
            error.method === "DELETE" &&
            isDelete
          ) {
            logger.warn(`Event ${event.id} was already deleted from Discord!`);
            return resolve(null);
          }
          logger.error(
            error,
            "An error occurred while managing a Discord scheduled event.",
          );
          reject(
            new DiscordEventError({
              message: "An error occurred while interacting with Discord.",
            }),
          );
        }
      });

      client.login(config.botToken).catch((loginError) => {
        logger.error(loginError, "Failed to log in to Discord.");
        reject(new DiscordEventError({ message: "Discord login failed." }));
      });
    });

    return result;
  } finally {
    if (client.readyAt) {
      await client.destroy();
      logger.debug("Logged out of Discord.");
    }
  }
};
