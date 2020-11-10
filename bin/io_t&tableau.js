#!/usr/bin/env node

const cdk = require('@aws-cdk/core');
const { IoT&tableauStack } = require('../lib/io_t&tableau-stack');

const app = new cdk.App();
new IoT&tableauStack(app, 'IoT&tableauStack');
