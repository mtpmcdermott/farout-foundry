# Foundry VTT AWS CDK Project

This project defines the AWS infrastructure and deployment scripts required to host a Foundry VTT server on an EC2 instance, with automated S3 backups and Let's Encrypt HTTPS support.

## Deployment

We use a custom wrapper script (`deploy.sh`) to automate the deployment process and securely manage secrets via AWS Systems Manager (SSM) Parameter Store. This ensures no plaintext passwords end up in CloudFormation templates, EC2 logs, or your source control.

### 1. Configuration Check
Create a `secrets.env` file in the root of the project (this file is ignored by git for security). Populate `secrets.env` with your sensitive Foundry properties:

```bash
EMAIL=email@example.comqq
FOUNDRY_USERNAME=Something
FOUNDRY_PASSWORD=YourPasswordHere
FOUNDRY_ADMIN_KEY=YourAdminKeyHere
FOUNDRY_LICENSE_KEY=YourLicenseHere
```

### 2. Run Deploy
Run the deploy script. You can optionally pass your desired domain name as the first argument; otherwise, it defaults to `really.farout.cool`. This script handles pushing your encrypted secrets to SSM and deploying the CDK stack:

```bash
./deploy.sh
# OR
./deploy.sh my-custom-domain.com
```
*(Or run `./deploy.sh "none"` if you want to explicitly skip HTTPS)*

## Other Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk diff`    compare deployed stack with current state

## Automatic Scheduling

The EC2 instance is configured to automatically turn on and off using AWS EventBridge Scheduler:
- **Turn ON:** Every Friday at 3:00 PM Pacific Time.
- **Turn OFF:** Every Saturday at 1:00 AM Pacific Time.

This schedule is designed to save costs while ensuring the server is available for weekend sessions.

## Discord Bot Integration

You can manage the FoundryVTT server directly from Discord using slash commands (e.g., `/foundry start`, `/foundry stop`, `/foundry status`).

### Setup Instructions

1. **Create a Discord Application**: Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. **Gather Credentials**:
   - Navigate to the **General Information** tab. Copy the "Application ID" (an 18-to-20 digit number) and "Public Key" (a 64-character hex string).
   - Navigate to the **Bot** tab, and click "Reset Token" to reveal the bot secret token.
   - Enter these explicitly in your `secrets.env` file (refer to `secrets.env.example`):
     - `DISCORD_APPLICATION_ID` (the 18-to-20 digit number)
     - `DISCORD_PUBLIC_KEY` (the 64-character hex string)
     - `DISCORD_BOT_TOKEN`
3. **Deploy Infrastructure**: Run `./deploy.sh` to seamlessly set up the AWS API Gateway, Lambda Functions, and SSM Parameter logic.
4. **Link the bot to API Gateway**:
   - Upon successful deployment, the console will output a Custom webhook URL named `DiscordInteractionsEndpoint` (e.g., `https://bot.really.farout.cool/`).
   - Paste this URL directly into the **Interactions Endpoint URL** input box back inside the Discord Portal's General Information tab, and click Save to perform the automated security verification.
5. **Register Commands**: Run `npm run register-commands` locally. This script pushes the `/foundry` command definitions directly to Discord.
6. **Invite the Bot**: Go to **OAuth2 -> URL Generator**, tick `applications.commands` and `bot`, select `Send Messages` for the bot permissions, and finally use the generated link to invite the bot to your Discord server!
