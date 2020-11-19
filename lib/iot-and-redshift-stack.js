const { Stack, CfnParameter, CfnOutput, RemovalPolicy, CfnMapping, Fn } = require('@aws-cdk/core')
const { Role, ServicePrincipal, PolicyStatement, Effect } = require('@aws-cdk/aws-iam')
const { Bucket } = require('@aws-cdk/aws-s3')
const { Vpc, SecurityGroup, SubnetType, Peer, Port, CfnRoute } = require('@aws-cdk/aws-ec2')
const { CfnThing, CfnTopicRule } = require('@aws-cdk/aws-iot')
const { CfnDeliveryStream } = require('@aws-cdk/aws-kinesisfirehose')
const { Cluster, ClusterType, NodeType } = require('@aws-cdk/aws-redshift')
const { LogGroup, LogStream } = require('@aws-cdk/aws-logs')

const FIREHOSE_CIDR_BLOCKS = {
  'us-east-1': {
    cidrBlock: '52.70.63.192/27'
  },
  'us-east-2': {
    cidrBlock: '13.58.135.96/27'
  },
  'us-west-1': {
    cidrBlock: '13.57.135.192/27'
  },
  'us-west-2': {
    cidrBlock: '52.89.255.224/27'
  },
  'ap-northeast-1': {
    cidrBlock: '13.113.196.224/27'
  },
  'ap-southeast-1': {
    cidrBlock: '13.228.64.192/27'
  },
  'ap-southeast-2': {
    cidrBlock: '13.210.67.224/27'
  }
}

class IotAndRedshiftStack extends Stack {
  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props)
    this._createParameters()
    this._createMappings()
    const bucket = this._createBucket()
    const firehoseDeliverToRedshiftRole = this._createFirehoseDeliverToRedshiftRole({
      bucket: bucket
    })
    const iotRuleToFirehoseRole = this._createIotRuleToFirehoseRole()
    const redshiftVpc = this._createVpc()
    const redshiftSecurityGroup = this._createSecurityGroup({
      vpc: redshiftVpc,
      ports: [
        {
          name: 'Redshift',
          number: this.redshiftDatabasePort.value
        }
      ]
    })
    const redshiftCluster = this._createRedshiftCluster({
      vpc: redshiftVpc,
      securityGroups: [
        redshiftSecurityGroup
      ]
    })
    const logGroup = this._createCloudWatchLogGroup()
    const logStream = this._createCloudWatchLogStream(logGroup)
    const redshiftDeliveryStream = this._createRedshiftDeliveryStream({
      redshiftCluster: redshiftCluster,
      s3Bucket: bucket,
      s3BucketRole: firehoseDeliverToRedshiftRole,
      deliverToRedshiftRole: firehoseDeliverToRedshiftRole,
      logGroup: logGroup,
      s3LogStream: logStream.s3,
      redshiftLogStream: logStream.redshift
    })
    const iotThing = this._createIotThing()
    const iotRule = this._createIotRule({
      deliveryStream: redshiftDeliveryStream,
      thing: iotThing,
      role: iotRuleToFirehoseRole,
    })
    this._createOutputs({
      redshiftCluster,
      iotThing,
      iotRule
    })
  }

  _createParameters() {
    this.redshiftDatabaseName = new CfnParameter(this, 'Database', {
      type: 'String',
      default: 'iot',
      description: 'Redshift database name'
    })
    this.redshiftDatabasePort = new CfnParameter(this, 'Port', {
      type: 'String',
      default: 5439,
      description: 'Redshift database port'
    })
    this.redshiftUsername = new CfnParameter(this, 'Username', {
      type: 'String',
      default: 'minche',
      description: 'Redshift database username'
    })
    this.redshiftPassword = new CfnParameter(this, 'Password', {
      type: 'String',
      default: 'Iot#52657055',
      description: 'Redshift database password'
    })
    this.redshiftTableName = new CfnParameter(this, 'TableName', {
      type: 'String',
      default: 'temperature',
      description: 'Redshift table name'
    })
  }

  _createMappings() {
    new CfnMapping(this, 'FirehoseCidrBlock', {
      mapping: FIREHOSE_CIDR_BLOCKS
    })
  }

  _createBucket() {
    return new Bucket(this, 'IoTData')
  }

  _createVpc() {
    const vpc = new Vpc(this, 'RedshiftVpc', {
      cidr: '192.168.0.0/16',
      maxAzs: 1,
      subnetConfiguration: [
        {
          cidrMask: 26,
          name: 'RedshiftPublicSubnet',
          subnetType: SubnetType.PUBLIC
        },
        {
          cidrMask: 26,
          name: 'RedshiftPrivateSubnet',
          subnetType: SubnetType.PRIVATE
        }
      ]
    })
    const firehoseCidrBlock = Fn.findInMap('FirehoseCidrBlock', this.region, 'cidrBlock')
    vpc.privateSubnets.forEach(({ routeTable: { routeTableId } }, index) => {
      new CfnRoute(this, 'PrivateSubnetFirehoseRoute' + index, {
        routeTableId,
        destinationCidrBlock: firehoseCidrBlock,
        gatewayId: vpc.internetGatewayId
      })
    })
    return vpc
  }

  _createSecurityGroup({ vpc, ports = [] }) {
    const securityGroup = new SecurityGroup(this, 'RedshiftSecurityGroup', {
      vpc: vpc,
      allowAllOutbound: true
    })
    for (const port of ports) {
      securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(port.number), port.name)
      securityGroup.addIngressRule(Peer.anyIpv6(), Port.tcp(port.number), port.name)
    }
    return securityGroup
  }

  _createRedshiftCluster({ vpc, securityGroups, numberOfNodes = 1 }) {
    return new Cluster(this, 'TableauCluster', {
      clusterName: 'tableau-cluster',
      clusterType: ClusterType.SINGLE_NODE,
      numberOfNodes: numberOfNodes,
      nodeType: NodeType.DC2_LARGE,
      defaultDatabaseName: this.redshiftDatabaseName.value,
      port: this.redshiftDatabasePort.value,
      masterUser: {
        masterUsername: this.redshiftUsername.value,
        masterPassword: this.redshiftPassword.value
      },
      publiclyAccessible: true,
      vpc: vpc,
      securityGroups: securityGroups,
      removalPolicy: RemovalPolicy.DESTROY
    })
  }

  _createCloudWatchLogGroup() {
    return new LogGroup(this, 'ReshiftDeliveryLogGroup', {
      logGroupName: '/aws/kinesisfirehose/ReshiftDeliveryStreamLogGroup',
      removalPolicy: RemovalPolicy.DESTROY
    })
  }

  _createCloudWatchLogStream(logGroup) {
    return {
      s3: new LogStream(this, 'ReshiftDeliveryS3LogStream', {
        logGroup: logGroup,
        logStreamName: 'S3Delivery',
        removalPolicy: RemovalPolicy.DESTROY
      }),
      redshift: new LogStream(this, 'ReshiftDeliveryRedshiftLogStream', {
        logGroup: logGroup,
        logStreamName: 'RedshiftDelivery',
        removalPolicy: RemovalPolicy.DESTROY
      })
    }
  }

  _createRedshiftDeliveryStream({ redshiftCluster, s3Bucket, s3BucketRole, logGroup, s3LogStream, redshiftLogStream, deliverToRedshiftRole }) {
    return new CfnDeliveryStream(this, 'RedshiftDeliveryStream', {
      deliveryStreamName: 'RedshiftDeliveryStream',
      redshiftDestinationConfiguration: {
        clusterJdbcurl: `jdbc:redshift://${redshiftCluster.clusterEndpoint.hostname}:${this.redshiftDatabasePort.value}/${this.redshiftDatabaseName.value}`,
        username: this.redshiftUsername.value,
        password: this.redshiftPassword.value,
        roleArn: deliverToRedshiftRole.roleArn,
        s3Configuration: {
          bucketArn: s3Bucket.bucketArn,
          prefix: 'iot-',
          roleArn: s3BucketRole.roleArn,
          bufferingHints: {
            sizeInMBs: 1,
            intervalInSeconds: 60
          },
          cloudWatchLoggingOptions: {
            logGroupName: logGroup.logGroupName,
            logStreamName: s3LogStream.logStreamName
          }
        },
        cloudWatchLoggingOptions: {
          logGroupName: logGroup.logGroupName,
          logStreamName: redshiftLogStream.logStreamName,
          enabled: true
        },
        copyCommand: {
          copyOptions: 'json \'auto\'',
          dataTableName: this.redshiftTableName.value
        },
        retryOptions: {
          durationInSeconds: 60 * 5
        }
      }
    })
  }

  _createFirehoseDeliverToRedshiftRole({ bucket }) {
    const firehoseDeliverToRedshiftRole = new Role(this, 'FirehoseDeliverToRedshiftRole', {
      assumedBy: new ServicePrincipal('firehose.amazonaws.com')
    })
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'glue:GetTable',
          'glue:GetTableVersion',
          'glue:GetTableVersions'
        ],
        resources: [
          `arn:aws:glue:${this.region}:${this.account}:catalog`,
          `arn:aws:glue:${this.region}:${this.account}:database/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`,
          `arn:aws:glue:${this.region}:${this.account}:table/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
        ]
      })
    )
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:AbortMultipartUpload',
          's3:GetBucketLocation',
          's3:GetObject',
          's3:ListBucket',
          's3:ListBucketMultipartUploads',
          's3:PutObject'
        ],
        resources: [
          `${bucket.bucketArn}`,
          `${bucket.bucketArn}/*`
        ]
      })
    )
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'lambda:InvokeFunction',
          'lambda:GetFunctionConfiguration'
        ],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
        ]
      })
    )
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kms:GenerateDataKey',
          'kms:Decrypt'
        ],
        resources: [
          `arn:aws:kms:${this.region}:${this.account}:key/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
        ]
      })
    )
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    )
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kinesis:DescribeStream',
          'kinesis:GetShardIterator',
          'kinesis:GetRecords',
          'kinesis:ListShards'
        ],
        resources: [
          `arn:aws:kinesis:${this.region}:${this.account}:stream/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
        ]
      })
    )
    firehoseDeliverToRedshiftRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'kms:Decrypt'
        ],
        resources: [
          `arn:aws:kms:${this.region}:${this.account}:key/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
        ],
        conditions: {
          StringEquals: {
            'kms:ViaService': `kinesis.${this.region}.amazonaws.com`
          },
          StringLike: {
            'kms:EncryptionContext:aws:kinesis:arn': `arn:aws:kinesis:${this.region}:${this.account}:stream/%FIREHOSE_POLICY_TEMPLATE_PLACEHOLDER%`
          }
        }
      })
    )
    return firehoseDeliverToRedshiftRole
  }

  _createIotRuleToFirehoseRole() {
    const iotRuleToFirehoseRole = new Role(this, 'IoTRuleToFirehoseRole', {
      assumedBy: new ServicePrincipal('iot.amazonaws.com')
    })
    iotRuleToFirehoseRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'firehose:PutRecord'
        ],
        resources: ['*']
      })
    )
    return iotRuleToFirehoseRole
  }

  _createIotThing() {
    return new CfnThing(this, 'TemperatureSensor', {
      thingName: 'temperature-sensor'
    })
  }

  _createIotRule({ deliveryStream, role, thing }) {
    return new CfnTopicRule(this, 'TemperatureDataToFirehose', {
      ruleName: 'TemperatureDataToFirehose',
      topicRulePayload: {
        awsIotSqlVersion: '2016-03-23',
        sql: `SELECT topic(3) as thing_name, state.reported.temperature as temperature, parse_time("YYYY-MM-dd hh:mm:ss", timestamp(), "UTC") as updated_at FROM "$aws/things/${thing.thingName}/shadow/update/accepted"`,
        actions: [
          {
            firehose: {
              deliveryStreamName: deliveryStream.deliveryStreamName,
              roleArn: role.roleArn
            }
          }
        ],
        ruleDisabled: false
      }
    })
  }

  _createOutputs({ redshiftCluster, redshiftUsername, iotThing, iotRule}) {
    new CfnOutput(this, 'Redshift Host', {
      value: redshiftCluster.clusterEndpoint.hostname
    })
    new CfnOutput(this, 'Redshift Port', {
      value: this.redshiftDatabasePort.value
    })
    new CfnOutput(this, 'Redshift Database Name', {
      value: this.redshiftDatabaseName.value
    })
    new CfnOutput(this, 'Redshift Endpoint', {
      value: `${redshiftCluster.clusterEndpoint.socketAddress}/${this.redshiftDatabaseName.value}`
    })
    new CfnOutput(this, 'Redshift JDBC URL', {
      value: `jdbc:redshift://${redshiftCluster.clusterEndpoint.socketAddress}/${this.redshiftDatabaseName.value}`
    })
    new CfnOutput(this, 'Redshift ODBC URL', {
      value: `Driver={Amazon Redshift (x64)}; Server=${redshiftCluster.clusterEndpoint.hostname}; Database=${this.redshiftDatabaseName}; UID=${this.redshiftUsername.value}; PWD=YOUR PASSWORD; Port=${this.redshiftDatabasePort.value}`
    })
    new CfnOutput(this, 'IoT Thing name', {
      value: iotThing.thingName
    })
    new CfnOutput(this, 'IoT Rule', {
      value: iotRule.topicRulePayload.sql
    })
  }
}

module.exports = { IotAndRedshiftStack }
