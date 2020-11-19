#!/usr/bin/env node

const cdk = require('@aws-cdk/core');
const { TableauServerStack } = require('../lib/tableau-server-stack');

const app = new cdk.App();
new TableauServerStack(app, 'TableauServerStack');
