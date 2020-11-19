#!/usr/bin/env node

const cdk = require('@aws-cdk/core');
const { IotAndRedshiftStack } = require('../lib/iot-and-redshift-stack');

const app = new cdk.App();
new IotAndRedshiftStack(app, 'IotAndRedshiftStack');
