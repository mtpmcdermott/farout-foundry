import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import * as ReallyFaroutCool from '../lib/really.farout.cool-stack';

test('Scheduler Resources Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new ReallyFaroutCool.ReallyFaroutCoolStack(app, 'MyTestStack');
  // THEN
  const template = Template.fromStack(stack);

  // Check for the IAM Role
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {
            Service: 'scheduler.amazonaws.com'
          }
        }
      ]
    }
  });

  // Check for the Start Schedule
  template.hasResourceProperties('AWS::Scheduler::Schedule', {
    ScheduleExpression: 'cron(0 15 ? * FRI *)',
    ScheduleExpressionTimezone: 'America/Los_Angeles',
    Target: {
      Arn: 'arn:aws:scheduler:::aws-sdk:ec2:startInstances'
    }
  });

  // Check for the Stop Schedule
  template.hasResourceProperties('AWS::Scheduler::Schedule', {
    ScheduleExpression: 'cron(0 1 ? * SAT *)',
    ScheduleExpressionTimezone: 'America/Los_Angeles',
    Target: {
      Arn: 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances'
    }
  });
});
