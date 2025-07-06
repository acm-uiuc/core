import { LambdaClient, InvokeCommand, LogType } from "@aws-sdk/client-lambda";
import { TextDecoder } from "util";

const lambdaClient = new LambdaClient({});
const textDecoder = new TextDecoder();

interface WarmerEvent {
  lambdaName: string;
  numInstances: number;
}

/**
 * Invokes a batch of lambdas concurrently and returns the unique instance IDs found.
 */
async function invokeBatch(
  lambdaName: string,
  count: number,
): Promise<Set<string>> {
  if (count <= 0) {
    return new Set();
  }

  console.log(`Firing a batch of ${count} concurrent invocations...`);

  const invocationPromises = Array.from({ length: count }, () => {
    const command = new InvokeCommand({
      FunctionName: lambdaName,
      InvocationType: "RequestResponse",
      LogType: LogType.Tail,
      Payload: JSON.stringify({ action: "warmup" }),
    });
    return lambdaClient.send(command);
  });

  const results = await Promise.allSettled(invocationPromises);
  const foundInstanceIds = new Set<string>();

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      try {
        const payloadString = textDecoder.decode(result.value.Payload);
        const payload = JSON.parse(payloadString);
        if (payload.instanceId) {
          foundInstanceIds.add(payload.instanceId);
        }
      } catch (e) {
        // Suppress errors for failed payload parsing
      }
    }
  });

  return foundInstanceIds;
}

export const handler = async (event: {}) => {
  const { lambdaName, numInstancesStr } = {
    lambdaName: process.env.LAMBDA_NAME,
    numInstancesStr: process.env.NUM_INSTANCES,
  };
  if (!lambdaName || !numInstancesStr) {
    throw new Error("Parameters 'lambdaName' and 'numInstances' are required.");
  }
  const numInstances = parseInt(numInstancesStr, 10);

  let totalInvocations = 0;

  const uniqueInstanceIds = await invokeBatch(lambdaName, numInstances);
  totalInvocations += numInstances;

  console.log(
    `Wave 1 complete. Found ${uniqueInstanceIds.size} of ${numInstances} unique instances.`,
  );

  if (uniqueInstanceIds.size < numInstances) {
    console.log(
      `Target not met. Firing another full batch of ${numInstances} invocations.`,
    );

    const secondWaveIds = await invokeBatch(lambdaName, numInstances);
    totalInvocations += numInstances;

    secondWaveIds.forEach((id) => uniqueInstanceIds.add(id));

    console.log(
      `Wave 2 complete. Total unique instances is now ${uniqueInstanceIds.size}.`,
    );
  }

  console.log(
    `Warming complete. Found ${uniqueInstanceIds.size} unique instances from ${totalInvocations} total invocations.`,
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      targetInstances: numInstances,
      warmedInstances: uniqueInstanceIds.size,
      totalInvocations,
      instanceIds: [...uniqueInstanceIds],
    }),
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.env.LAMBDA_NAME = "infra-core-api-lambda";
  process.env.NUM_INSTANCES = "2";
  console.log(await handler({}));
}
