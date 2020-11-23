const { Stack, CfnParameter, CfnOutput } = require('@aws-cdk/core')
const { KeyPair } = require('cdk-ec2-key-pair')
const { Role, ServicePrincipal, PolicyStatement, ManagedPolicy, CfnInstanceProfile, Effect } = require('@aws-cdk/aws-iam')
const { CfnStack } = require('@aws-cdk/aws-cloudformation')
const { Vpc, SubnetType } = require('@aws-cdk/aws-ec2')

const S3_BUCKET = 'aws-quickstart'
const QS_S3_REGION = 'us-east-1'
const QS_S3_KEY_PREFIX = 'quickstart-tableau-server/'
const QS_TABLEAU_WORKLOAD_TEMPLATE = 'tableau-single-server-centos.template'

const TABLEAU_SERVER = {
  ACCEPT_EULA: 'yes',
  INSTANCE_TYPE: 'm4.2xlarge',
  SOURCE_CIDR: '0.0.0.0/0',
  COUNTRY: 'Taiwan',
  CITY: 'Taipei',
  STATE: '',
  ZIP: '114',
  INDUSTRY: 'Software',
  COMPANY: 'SoftChef',
  DEPARTMENT: 'IoT',
  TITLE: 'Engineer',
  FIRST_NAME: 'Soft',
  LAST_NAME: 'Chef',
  EMAIL: 'dev@softchef.com',
  PHONE: '+886980666999'
}

class TableauServerStack extends Stack {
  /**
   *
   * @param {cdk.Construct} scope
   * @param {string} id
   * @param {cdk.StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props)
    const username = new CfnParameter(this, 'Username', {
      type: 'String',
      description: 'Tableau Server username'
    })
    const password = new CfnParameter(this, 'Password', {
      type: 'String',
      description: 'Tableau Server user password'
    })
    const licenseKey = new CfnParameter(this, 'LicenseKey', {
      type: 'String',
      description: 'Tableau Server license key'
    })
    const keyPair = this._createKeyPair()
    const tableauRole = this._createTableauRole()
    const instanceProfile = this._createInstanceProfile({
      role: tableauRole
    })
    const vpc = this._createVpc()
    const workloadStack = this._createWorkloadStack({
      vpc,
      keyPair,
      instanceProfile,
      username,
      password,
      licenseKey
    })
    this._createOutputs({
      workloadStack
    })
  }

  _createKeyPair() {
    return new KeyPair(this, 'TableauServerKeyPair', {
      name: 'tableau-server-key-pair'
    })
  }

  _createTableauRole() {
    const tableauRole = new Role(this, 'TableauRole', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com')
    })
    tableauRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    )
    tableauRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMDirectoryServiceAccess')
    )
    tableauRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    )
    tableauRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:GetObject'
        ],
        resources: [
          `arn:aws:s3:::${S3_BUCKET}/${QS_S3_KEY_PREFIX}*`
        ]
      })
    )
    return tableauRole
  }

  _createInstanceProfile({ role }) {
    return new CfnInstanceProfile(this, 'TableauServerInstanceProfile', {
      instanceProfileName: 'tableau-server',
      path: '/',
      roles: [
        role.roleName
      ]
    })
  }

  _createVpc() {
    return new Vpc(this, 'TableauServerVpc', {
      cidr: '192.168.0.0/16',
      maxAzs: 1,
      subnetConfiguration: [
        {
          cidrMask: 26,
          name: 'RedshiftPublicSubnet',
          subnetType: SubnetType.PUBLIC
        }
      ],
      natGateways: 0
    })
  }

  _createWorkloadStack({ vpc, keyPair, instanceProfile, username, password, licenseKey }) {
    return new CfnStack(this, 'WorkloadStack', {
      templateUrl: `https://${S3_BUCKET}.s3.${QS_S3_REGION}.amazonaws.com/${QS_S3_KEY_PREFIX}templates/${QS_TABLEAU_WORKLOAD_TEMPLATE}`,
      parameters: {
        VPCId: vpc.vpcId,
        PublicSubnetId: vpc.publicSubnets[0].subnetId,
        AcceptEULA: TABLEAU_SERVER.ACCEPT_EULA,
        InstanceType: TABLEAU_SERVER.INSTANCE_TYPE,
        KeyPairName: keyPair.name,
        Username: username,
        Password: password,
        TableauServerAdminUser: username,
        TableauServerAdminPassword: password,
        TableauServerLicenseKey: licenseKey,
        TableauServerInstanceProfile: instanceProfile.instanceProfileName,
        SourceCIDR: TABLEAU_SERVER.SOURCE_CIDR,
        RegCountry: TABLEAU_SERVER.COUNTRY,
        RegCity: TABLEAU_SERVER.CITY,
        RegState: TABLEAU_SERVER.STATE,
        RegZip: TABLEAU_SERVER.ZIP,
        RegIndustry: TABLEAU_SERVER.INDUSTRY,
        RegCompany: TABLEAU_SERVER.COMPANY,
        RegDepartment: TABLEAU_SERVER.DEPARTMENT,
        RegTitle: TABLEAU_SERVER.TITLE,
        RegFirstName: TABLEAU_SERVER.FIRST_NAME,
        RegLastName: TABLEAU_SERVER.LAST_NAME,
        RegEmail: TABLEAU_SERVER.EMAIL,
        RegPhone: TABLEAU_SERVER.PHONE
      }
    })
  }

  _createOutputs({ workloadStack }) {
    new CfnOutput(this, 'InstanceID', {
      value: workloadStack.getAtt('Outputs.InstanceID'),
      description: 'EC2 InstanceID of the instance running Tableau Server'
    })
    new CfnOutput(this, 'PublicIPAddress', {
      value: workloadStack.getAtt('Outputs.PublicIPAddress'),
      description: 'Public IP Address of instance running Tableau Server'
    })
    new CfnOutput(this, 'TableauServicesManagerURL', {
      value: workloadStack.getAtt('Outputs.TableauServicesManagerURL'),
      description: 'URL for the TSM Web UI'
    })
    new CfnOutput(this, 'TableauServerURL', {
      value: workloadStack.getAtt('Outputs.TableauServerURL'),
      description: 'URL for the Tableau Server'
    })
  }
}

module.exports = { TableauServerStack }
