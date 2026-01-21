import { ValidLoggers } from "api/types.js";
import { BaseError, InternalServerError } from "common/errors/index.js";

export interface EnsurePaidMemberListmonkEnrollmentInputs {
  netId: string;
  firstName: string;
  lastName: string;
  logger: ValidLoggers;
  apiUsername: string;
  apiToken: string;
  listmonkBaseUrl: string;
  paidMemberLists: number[];
}

export interface HandleListmonkEnrollmentInputs {
  listmonkBaseUrl: string;
  lists: number[];
  firstName: string;
  lastName: string;
  email: string;
  logger: ValidLoggers;
  apiUsername: string;
  apiToken: string;
}

export async function handleListmonkEnrollment({
  listmonkBaseUrl,
  lists,
  firstName,
  lastName,
  email,
  logger,
  apiUsername,
  apiToken,
}: HandleListmonkEnrollmentInputs) {
  const credentials = Buffer.from(`${apiUsername}:${apiToken}`).toString(
    "base64",
  );
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${credentials}`,
  };

  // Helper for fetch with timeout
  const fetchWithTimeout = async (url: string, options: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  // Try to create subscriber
  const createResponse = await fetchWithTimeout(
    `${listmonkBaseUrl}/api/subscribers`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        name: `${firstName} ${lastName}`.trim(),
        status: "enabled",
        lists,
        preconfirm_subscriptions: true,
      }),
    },
  );

  const createBody = await createResponse.json();

  if (createResponse.ok) {
    return createBody as {
      data: {
        id: number;
        created_at: string;
        updated_at: string;
        uuid: string;
      };
    };
  }

  // Handle existing email case
  if (
    (createBody as { message: string }).message === "E-mail already exists."
  ) {
    logger.warn(
      "Email already exists, fetching subscriber and updating lists.",
    );

    // Query for existing subscriber by email
    const query = encodeURIComponent(`subscribers.email = '${email}'`);
    const searchResponse = await fetchWithTimeout(
      `${listmonkBaseUrl}/api/subscribers?query=${query}&per_page=1`,
      {
        method: "GET",
        headers,
      },
    );

    if (!searchResponse.ok) {
      const searchBody = await searchResponse.json();
      logger.error(
        `Failed to search for subscriber: ${JSON.stringify(searchBody)}`,
      );
      throw new InternalServerError({
        message: "Failed to search for existing subscriber",
      });
    }

    const searchBody = (await searchResponse.json()) as {
      data: {
        results: Array<{
          id: number;
          created_at: string;
          updated_at: string;
          uuid: string;
        }>;
      };
    };

    const existingSubscriber = searchBody.data.results[0];
    if (!existingSubscriber) {
      logger.error("Email exists but subscriber not found in search");
      throw new InternalServerError({
        message: "Subscriber exists but could not be retrieved",
      });
    }

    // Add subscriber to the requested lists using PUT /api/subscribers/lists
    const updateListsResponse = await fetchWithTimeout(
      `${listmonkBaseUrl}/api/subscribers/lists`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ids: [existingSubscriber.id],
          action: "add",
          target_list_ids: lists,
          status: "confirmed",
        }),
      },
    );

    if (!updateListsResponse.ok) {
      const updateBody = await updateListsResponse.json();
      logger.error(
        `Failed to update subscriber lists: ${JSON.stringify(updateBody)}`,
      );
      throw new InternalServerError({
        message: "Failed to add existing subscriber to lists",
      });
    }

    logger.info(
      `Added existing subscriber ${existingSubscriber.id} to lists ${lists}`,
    );

    return {
      data: existingSubscriber,
    };
  }

  // Some other error occurred
  logger.error(`Listmonk enrollment failed: ${JSON.stringify(createBody)}`);
  throw new InternalServerError({
    message: "Failed to enroll user in listmonk lists",
  });
}

export async function ensurePaidMemberListmonkEnrollment({
  netId,
  firstName,
  lastName,
  logger,
  apiToken,
  apiUsername,
  listmonkBaseUrl,
  paidMemberLists,
}: EnsurePaidMemberListmonkEnrollmentInputs) {
  try {
    await handleListmonkEnrollment({
      apiToken,
      apiUsername,
      listmonkBaseUrl,
      firstName,
      lastName,
      email: `${netId}@illinois.edu`,
      logger,
      lists: paidMemberLists,
    });
  } catch (e) {
    if (e instanceof BaseError) {
      throw e;
    }
    logger.error(e, "An error occurred setting Listmonk enrollment.");
    throw new InternalServerError({
      message: "An error occurred setting Listmonk enrollment.",
    });
  }
}
