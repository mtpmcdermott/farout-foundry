import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import * as ReallyFaroutCool from '../lib/really.farout.cool-stack';

test('EC2 Instance has 20GB EBS Storage', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new ReallyFaroutCool.ReallyFaroutCoolStack(app, 'MyTestStack');
  // THEN
  const template = Template.fromStack(stack);
  console.log(JSON.stringify(template.toJSON(), null, 2));

  template.hasResourceProperties('AWS::EC2::Instance', {
    BlockDeviceMappings: [
      {
        DeviceName: '/dev/xvda',
        Ebs: {
          VolumeSize: 21
        }
      }
    ]
  });
});
