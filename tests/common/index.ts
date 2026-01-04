import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export const getSsmParameter = async (parameterName: string) => {
  const client = new SSMClient({
    region: process.env.AWS_REGION ?? "us-east-2",
  });

  const params = {
    Name: parameterName,
    WithDecryption: true,
  };

  const command = new GetParameterCommand(params);

  try {
    const data = await client.send(command);
    if (!data.Parameter || !data.Parameter.Value) {
      console.error(`Parameter ${parameterName} not found`);
      return null;
    }
    return data.Parameter.Value;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Error retrieving parameter ${parameterName}: ${errorMessage}`,
      error,
    );
    return null;
  }
};
