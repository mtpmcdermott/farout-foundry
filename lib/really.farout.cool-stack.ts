import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

export class ReallyFaroutCoolStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
    });

    // Grant the role read/write permissions to the bucket
    bucket.grantReadWrite(instanceRole);

    // Grant the role permission to read secrets from SSM Parameter Store
    instanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/foundry/*`],
    }));

    // Instance Profile wrapping the role
    new iam.CfnInstanceProfile(this, 'FoundryVttInstanceProfile', {
      roles: [instanceRole.roleName],
    });
  }
}
