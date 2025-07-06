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
      Payload: JSON.stringify({ action: "warmer" }),
    });
    return lambdaClient.send(command);
  });

  const results = await Promise.allSettled(invocationPromises);
  const foundInstanceIds = new Set<string>();

  results.forEach((result) => {
    if (result.status === "fulfilled" && result.value.Payload) {
      try {
        const payloadString = textDecoder.decode(result.value.Payload);
        const body = JSON.parse(payloadString);
        if (body.instanceId) {
          foundInstanceIds.add(body.instanceId);
        }
      } catch (e) {
        console.error("Error parsing payload from target function:", e);
      }
    } else if (result.status === "rejected") {
      console.error("Invocation failed:", result.reason.message);
    }
  });

  return foundInstanceIds;
}

export const handler = async (event: {}) => {
  const { lambdaName, numInstancesStr, maxWavesStr } = {
    lambdaName: process.env.LAMBDA_NAME,
    numInstancesStr: process.env.NUM_INSTANCES,
    maxWavesStr: process.env.MAX_WAVES,
  };

  if (!lambdaName || !numInstancesStr) {
    throw new Error("Env vars 'LAMBDA_NAME' and 'NUM_INSTANCES' are required.");
  }

  const numInstances = parseInt(numInstancesStr, 10);
  // Default to 2 waves if MAX_WAVES is not set
  const maxWaves = parseInt(maxWavesStr || "2", 10);

  let totalInvocations = 0;
  let wavesCompleted = 0;
  const uniqueInstanceIds = new Set<string>();

  for (let i = 1; i <= maxWaves; i++) {
    wavesCompleted = i;

    // Calculate how many more instances are needed
    const neededCount = numInstances - uniqueInstanceIds.size;
    if (neededCount <= 0) {
      console.log("Target met. No more waves needed.");
      break;
    }

    console.log(`--- Wave ${i} of ${maxWaves} ---`);
    const newIds = await invokeBatch(lambdaName, numInstances);
    totalInvocations += numInstances;

    newIds.forEach((id) => uniqueInstanceIds.add(id));

    console.log(
      `Wave ${i} complete. Found ${uniqueInstanceIds.size} of ${numInstances} unique instances.`,
    );
  }

  console.log(
    `Warming complete. Found ${uniqueInstanceIds.size} unique instances from ${totalInvocations} total invocations over ${wavesCompleted} waves.`,
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      targetInstances: numInstances,
      warmedInstances: uniqueInstanceIds.size,
      totalInvocations,
      wavesCompleted,
      instanceIds: [...uniqueInstanceIds],
    }),
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.env.LAMBDA_NAME = "infra-core-api-lambda";
  process.env.NUM_INSTANCES = "3";
  process.env.MAX_WAVES = "3"; // Configurable number of waves
  console.log(await handler({}));
}
