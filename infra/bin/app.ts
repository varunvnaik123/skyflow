#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { SkyFlowStack } from '../lib/skyflow-stack.js';

const app = new App();

new SkyFlowStack(app, 'SkyFlowStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2'
  }
});
