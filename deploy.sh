#!/bin/bash
set -e

if [ -z "$1" ]; then
  DOMAIN_NAME="really.farout.cool"
  echo "No domain provided. Defaulting to: $DOMAIN_NAME"
else
  DOMAIN_NAME="$1"
fi

echo "Pushing domain configuration..."
aws ssm put-parameter --name "/foundry/domain" --value "$DOMAIN_NAME" --type "String" --overwrite >/dev/null

echo "Loading .env secrets..."
if [ ! -f secrets.env ]; then
  echo "Error: secrets.env file not found."
  echo "Please create it using the template provided."
  exit 1
fi
source secrets.env

echo "Pushing secrets to SSM Parameter Store..."
aws ssm put-parameter --name "/foundry/email" --value "$EMAIL" --type "SecureString" --overwrite >/dev/null
aws ssm put-parameter --name "/foundry/username" --value "$FOUNDRY_USERNAME" --type "SecureString" --overwrite >/dev/null
aws ssm put-parameter --name "/foundry/password" --value "$FOUNDRY_PASSWORD" --type "SecureString" --overwrite >/dev/null
aws ssm put-parameter --name "/foundry/admin_key" --value "$FOUNDRY_ADMIN_KEY" --type "SecureString" --overwrite >/dev/null
aws ssm put-parameter --name "/foundry/license_key" --value "$FOUNDRY_LICENSE_KEY" --type "SecureString" --overwrite >/dev/null

if [ -n "$DISCORD_PUBLIC_KEY" ]; then
  aws ssm put-parameter --name "/foundry/discord/public_key" --value "$DISCORD_PUBLIC_KEY" --type "String" --overwrite >/dev/null
fi
if [ -n "$DISCORD_APPLICATION_ID" ]; then
  aws ssm put-parameter --name "/foundry/discord/application_id" --value "$DISCORD_APPLICATION_ID" --type "String" --overwrite >/dev/null
fi
if [ -n "$DISCORD_BOT_TOKEN" ]; then
  aws ssm put-parameter --name "/foundry/discord/bot_token" --value "$DISCORD_BOT_TOKEN" --type "SecureString" --overwrite >/dev/null
fi

echo "Secrets synced securely!"

echo "Deploying CDK Stack..."
# Pass the domain to CDK as a context variable just in case we need it at synth time
npx cdk deploy -c domain_name="$DOMAIN_NAME" --require-approval never
