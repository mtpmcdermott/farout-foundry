import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

// Read from secrets.env if it exists
try {
  const envFile = fs.readFileSync(path.join(__dirname, '../secrets.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  console.log('No secrets.env file found or accessible. Relying on process environment variables.');
}

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;

if (!token || !appId) {
  console.error("Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID in secrets.env (or environment variables).");
  process.exit(1);
}

const commands = [
  {
    name: 'foundry',
    description: 'Manage the FoundryVTT server',
    options: [
      {
        name: 'start',
        description: 'Starts the FoundryVTT EC2 instance',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'stop',
        description: 'Stops the FoundryVTT EC2 instance',
        type: 1,
      },
      {
        name: 'status',
        description: 'Checks the status of the FoundryVTT EC2 instance',
        type: 1,
      }
    ]
  }
];

const data = JSON.stringify(commands);

const options = {
  hostname: 'discord.com',
  port: 443,
  path: `/api/v10/applications/${appId}/commands`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bot ${token}`,
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let responseBody = '';
  res.on('data', (d) => {
    responseBody += d;
  });
  res.on('end', () => {
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log('Successfully registered commands!');
      console.log(responseBody);
    } else {
      console.error(`Failed to register commands. Status: ${res.statusCode}`);
      console.error(responseBody);
    }
  });
});

req.on('error', (error) => {
  console.error('Error registering commands:', error);
});

req.write(data);
req.end();
