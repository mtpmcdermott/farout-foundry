import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as fs from 'fs';
import * as path from 'path';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';

export class ReallyFaroutCoolStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = this.node.tryGetContext('domain_name') || 'really.farout.cool';

    // S3 Bucket for Foundry VTT Data
    const bucket = new s3.Bucket(this, 'FoundryVttDataBucket', {
      bucketName: `really-farout-cool-foundry-data-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // IAM Role for EC2 Instance
    const instanceRole = new iam.Role(this, 'FoundryVttInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Role for Foundry VTT EC2 instance to access S3',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // Grant the role read/write permissions to the bucket
    bucket.grantReadWrite(instanceRole);

    // Grant the role permission to read secrets from SSM Parameter Store
    instanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/foundry/*`],
    }));

    // VPC for the EC2 Instance
    const vpc = new ec2.Vpc(this, 'FoundryVttVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Security Group for the EC2 Instance
    const securityGroup = new ec2.SecurityGroup(this, 'FoundryVttSecurityGroup', {
      vpc,
      description: 'Allow HTTP, HTTPS, and SSH traffic',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH');

    // Instance Profile wrapping the role
    const instanceProfile = new iam.CfnInstanceProfile(this, 'FoundryVttInstanceProfile', {
      roles: [instanceRole.roleName],
    });


    // Package the entire assets directory as an S3 asset
    const instanceAssets = new s3_assets.Asset(this, 'FoundryAssets', {
      path: path.join(__dirname, '../assets'),
    });

    // Grant the instance role permission to read the asset from S3
    instanceAssets.grantRead(instanceRole);

    // EC2 Instance
    const instance = new ec2.Instance(this, 'FoundryVttInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: securityGroup,
      role: instanceRole,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      // Note: A key pair 'ftt' was used in the previous setup. We attach it if it exists.
      keyName: 'ftt',
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(21),
        },
      ],
    });

    // Provide the setup script and all other assets via S3 download
    const zipDest = '/tmp/assets.zip';
    const localDest = '/home/ec2-user/assets';

    instance.userData.addS3DownloadCommand({
      bucket: instanceAssets.bucket,
      bucketKey: instanceAssets.s3ObjectKey,
      localFile: zipDest,
    });

    instance.userData.addCommands(
      'dnf install -y unzip',
      `mkdir -p ${localDest}`,
      `unzip ${zipDest} -d ${localDest}`,
      `chown -R ec2-user:ec2-user ${localDest}`,
      `chmod +x ${localDest}/setup-foundry.sh`,
      `cd ${localDest} && ./setup-foundry.sh`
    );

    // Schedule: Start every Friday at 3pm Pacific Time, Stop every Saturday at 1am Pacific Time
    const schedulerRole = new iam.Role(this, 'FoundryVttSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler to start/stop the Foundry VTT instance',
    });

    schedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:StartInstances', 'ec2:StopInstances'],
      resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/${instance.instanceId}`],
    }));

    // Start Schedule: Friday 15:00 America/Los_Angeles
    new scheduler.CfnSchedule(this, 'StartFoundryVttSchedule', {
      flexibleTimeWindow: {
        mode: 'OFF',
      },
      scheduleExpression: 'cron(0 15 ? * FRI *)',
      scheduleExpressionTimezone: 'America/Los_Angeles',
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ec2:startInstances',
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ InstanceIds: [instance.instanceId] }),
      },
    });

    // Stop Schedule: Saturday 03:00 America/Los_Angeles
    new scheduler.CfnSchedule(this, 'StopFoundryVttSchedule', {
      flexibleTimeWindow: {
        mode: 'OFF',
      },
      scheduleExpression: 'cron(0 3 ? * SAT *)',
      scheduleExpressionTimezone: 'America/Los_Angeles',
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ InstanceIds: [instance.instanceId] }),
      },
    });

    // Output the public IP
    new cdk.CfnOutput(this, 'FoundryVttPublicIp', {
      value: instance.instancePublicIp,
      description: 'Public IP of the Foundry VTT Instance',
    });

    // Discord Bot Handler
    const discordPublicKey = ssm.StringParameter.valueForStringParameter(this, '/foundry/discord/public_key');

    const discordHandler = new lambdaNodejs.NodejsFunction(this, 'DiscordInteractionHandler', {
      entry: path.join(__dirname, 'discord-handler', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        INSTANCE_ID: instance.instanceId,
        DISCORD_PUBLIC_KEY: discordPublicKey,
      },
    });

    // Grant Lambda permission to start/stop the instance
    discordHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:StartInstances', 'ec2:StopInstances'],
      resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/${instance.instanceId}`],
    }));

    discordHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ec2:DescribeInstances'],
      resources: ['*'],
    }));

    // API Gateway for Discord to send webhooks to
    const api = new apigateway.RestApi(this, 'DiscordInteractionsApi', {
      restApiName: 'Discord Interactions Service',
      description: 'API Gateway endpoint for Discord slash commands',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    const integration = new apigateway.LambdaIntegration(discordHandler);
    api.root.addMethod('POST', integration);

    let apiUrl = api.url;

    // DNS Configuration
    if (domainName.endsWith('.farout.cool') || domainName === 'farout.cool') {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'FaroutCoolZone', {
        hostedZoneId: 'Z04445774113CCTGXAT7',
        zoneName: 'farout.cool',
      });

      new route53.ARecord(this, 'FoundryVttDnsRecord', {
        zone,
        recordName: domainName,
        target: route53.RecordTarget.fromIpAddresses(instance.instancePublicIp),
        ttl: cdk.Duration.minutes(1),
      });

      const botDomainName = 'bot.' + domainName;

      const certificate = new certificatemanager.Certificate(this, 'BotApiCertificate', {
        domainName: botDomainName,
        validation: certificatemanager.CertificateValidation.fromDns(zone),
      });

      const customDomain = api.addDomainName('BotDomainName', {
        domainName: botDomainName,
        certificate: certificate,
        endpointType: apigateway.EndpointType.REGIONAL,
      });

      new route53.ARecord(this, 'BotApiDnsRecord', {
        zone,
        recordName: botDomainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.ApiGatewayDomain(customDomain)),
      });

      apiUrl = `https://${botDomainName}/`;
    }

    new cdk.CfnOutput(this, 'DiscordInteractionsEndpoint', {
      value: apiUrl,
      description: 'The Discord Interactions Endpoint URL',
    });
  }
}
