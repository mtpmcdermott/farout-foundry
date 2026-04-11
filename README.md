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
