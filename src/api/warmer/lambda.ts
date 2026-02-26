/* eslint-disable no-console */
import {
  LambdaClient,
  InvokeCommand,
  InvokeWithResponseStreamCommand,
} from "@aws-sdk/client-lambda";
import { TextDecoder } from "util";

// --- AWS SDK Clients and Utilities ---
const lambdaClient = new LambdaClient({});
const textDecoder = new TextDecoder();

// --- Invocation Logic for Standard Lambdas ---

/**
 * Invokes a batch of standard (non-streaming) Lambdas concurrently.
 */
async function invokeStandardBatch(
  lambdaName: string,
  count: number,
): Promise<Set<string>> {
  const invocationPromises = Array.from({ length: count }, () =>
    lambdaClient.send(
      new InvokeCommand({
        FunctionName: lambdaName,
        Payload: JSON.stringify({ action: "warmer" }),
      }),
    ),
  );

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
        console.error("Error parsing payload from standard function:", e);
      }
    } else if (result.status === "rejected") {
      console.error("Standard invocation failed:", result.reason.message);
    }
  });

  return foundInstanceIds;
}

// --- Invocation Logic for Streaming Lambdas ---

/**
 * Invokes a batch of response-streaming Lambdas concurrently.
 */
async function invokeStreamingBatch(
  lambdaName: string,
  count: number,
): Promise<Set<string>> {
  const invocationPromises = Array.from({ length: count }, () =>
    lambdaClient.send(
      new InvokeWithResponseStreamCommand({
        FunctionName: lambdaName,
        Payload: JSON.stringify({ action: "warmer" }),
      }),
    ),
  );

  const results = await Promise.allSettled(invocationPromises);
  const foundInstanceIds = new Set<string>();

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.EventStream) {
      try {
        const chunks: Uint8Array[] = [];
        // Iterate over the EventStream to get data chunks
        for await (const event of result.value.EventStream) {
          if (event.PayloadChunk && event.PayloadChunk.Payload) {
            chunks.push(event.PayloadChunk.Payload);
          }
        }

        const payloadString = textDecoder.decode(Buffer.concat(chunks));
        const body = JSON.parse(payloadString);
        if (body.instanceId) {
          foundInstanceIds.add(body.instanceId);
        }
      } catch (e) {
        console.error("Error processing stream from streaming function:", e);
      }
    } else if (result.status === "rejected") {
      console.error("Streaming invocation failed:", result.reason.message);
    }
  }

  return foundInstanceIds;
}

// --- Main Lambda Handler ---

/**
 * Main handler that warms a target Lambda function by invoking it multiple times.
 * It can handle both standard and response-streaming target functions.
 */
export const handler = async (event: {}) => {
  const { lambdaName, numInstancesStr, maxWavesStr, isStreaming } = {
    lambdaName: process.env.LAMBDA_NAME,
    numInstancesStr: process.env.NUM_INSTANCES,
    maxWavesStr: process.env.MAX_WAVES,
    isStreaming: (process.env.IS_STREAMING || "false").toLowerCase() === "true", // e.g., 'true' or 'false'
  };

  if (!lambdaName || !numInstancesStr) {
    throw new Error("Env vars 'LAMBDA_NAME' and 'NUM_INSTANCES' are required.");
  }

  const numInstances = parseInt(numInstancesStr, 10);
  const maxWaves = parseInt(maxWavesStr || "5", 10);

  let totalInvocations = 0;
  let wavesCompleted = 0;
  const uniqueInstanceIds = new Set<string>();

  console.log(`Warming target: ${lambdaName} (Streaming: ${isStreaming})`);

  for (let i = 1; i <= maxWaves; i++) {
    wavesCompleted = i;
    const neededCount = numInstances - uniqueInstanceIds.size;
    if (neededCount <= 0) {
      console.log("Target met. No more waves needed.");
      break;
    }

    console.log(`-- - Wave ${i} of ${maxWaves} --- `);

    // Choose the correct invoker function based on the flag
    const newIds = isStreaming
      ? await invokeStreamingBatch(lambdaName, numInstances)
      : await invokeStandardBatch(lambdaName, numInstances);

    totalInvocations += numInstances;

    newIds.forEach((id) => uniqueInstanceIds.add(id));

    console.log(
      `Wave ${i} complete.Found ${uniqueInstanceIds.size} of ${numInstances} unique instances.`,
    );
  }

  console.log(
    `Warming complete.Found ${uniqueInstanceIds.size} unique instances from ${totalInvocations} total invocations over ${wavesCompleted} waves.`,
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

// --- Local Test Execution Block ---

// This block runs only when the file is executed directly (e.g., `node index.js`)
if (import.meta.url === `file://${process.argv[1]}`) {
  // --- Configuration for local testing ---
  process.env.LAMBDA_NAME = "my-target-lambda-function-name";
  process.env.NUM_INSTANCES = "3";
  process.env.MAX_WAVES = "5";
  process.env.IS_STREAMING = "false"; // Set to 'true' to test streaming

  console.log("Running warmer in local test mode...");
  handler({})
    .then((result) => {
      console.log("\n--- Final Result ---");
      console.log(JSON.parse(result.body));
    })
    .catch((error) => {
      console.error("Local test run failed:", error);
    });
}
