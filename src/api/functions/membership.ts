import { FastifyBaseLogger } from "fastify";

export async function checkPaidMembership(
  endpoint: string,
  log: FastifyBaseLogger,
  netId: string,
) {
  const membershipApiPayload = (await (
    await fetch(`${endpoint}?netId=${netId}`)
  ).json()) as { netId: string; isPaidMember: boolean };
  log.trace(`Got Membership API Payload for ${netId}: ${membershipApiPayload}`);
  try {
    return membershipApiPayload["isPaidMember"];
  } catch (e: unknown) {
    if (!(e instanceof Error)) {
      log.error(
        "Failed to get response from membership API (unknown error type.)",
      );
      throw e;
    }
    log.error(`Failed to get response from membership API: ${e.toString()}`);
    throw e;
  }
}
