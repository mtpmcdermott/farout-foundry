import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';
import { EC2Client, StartInstancesCommand, StopInstancesCommand, DescribeInstancesCommand } from '@aws-sdk/client-ec2';

const ec2 = new EC2Client({});
const INSTANCE_ID = process.env.INSTANCE_ID as string;
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY as string;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Received request:', event.httpMethod, event.path, { type: typeof event.body });

  const getHeader = (name: string) => {
    const key = Object.keys(event.headers).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? event.headers[key] : undefined;
  };

  const signature = getHeader('x-signature-ed25519');
  const timestamp = getHeader('x-signature-timestamp');
  const body = event.body;

  if (!signature || !timestamp || !body) {
    console.log('Missing signature/timestamp/body', { signature, timestamp, body: typeof body });
    return { statusCode: 401, body: 'Bad request signature' };
  }

  const isValidRequest = await verifyKey(body, signature, timestamp, PUBLIC_KEY);
  if (!isValidRequest) {
    console.log('Invalid signature', { signature, timestamp, PUBLIC_KEY });
    return { statusCode: 401, body: 'Bad request signature' };
  }

  const interaction = JSON.parse(body);

  if (interaction.type === InteractionType.PING) {
    console.log('Responding to PING');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: InteractionResponseType.PONG }),
    };
  }

  console.log('Handling App Command. Command data:', interaction.data);
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name } = interaction.data;

    let responseMessage = 'Unknown command';

    if (name === 'foundry') {
      const subCommand = interaction.data.options?.[0]?.name;

      if (subCommand === 'start') {
        try {
          await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
          responseMessage = 'Starting FoundryVTT server... It may take a minute or two to become available.';
        } catch (error) {
          console.error(error);
          responseMessage = `Failed to start server: ${(error as Error).message}`;
        }
      } else if (subCommand === 'stop') {
         try {
           await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
           responseMessage = 'Stopping FoundryVTT server...';
         } catch (error) {
           console.error(error);
           responseMessage = `Failed to stop server: ${(error as Error).message}`;
         }
      } else if (subCommand === 'status') {
         try {
           const result = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
           const state = result.Reservations?.[0]?.Instances?.[0]?.State?.Name;
           const ip = result.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;
           responseMessage = `FoundryVTT server is currently: **${state}**${ip && state === 'running' ? `\nIP: ${ip}` : ''}`;
         } catch (error) {
           console.error(error);
           responseMessage = `Failed to get status: ${(error as Error).message}`;
         }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: responseMessage,
        },
      }),
    };
  }

  console.log('Unknown interaction type', interaction.type);
  return { statusCode: 400, body: 'Unknown interaction type' };
};
