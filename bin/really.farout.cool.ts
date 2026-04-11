#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ReallyFaroutCoolStack } from '../lib/really.farout.cool-stack';

const app = new cdk.App();
new ReallyFaroutCoolStack(app, 'ReallyFaroutCoolStack', {
  env: { region: 'us-west-2' },
});
