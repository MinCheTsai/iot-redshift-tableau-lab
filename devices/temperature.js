const AWS = require('aws-sdk')
const awsIot = require('aws-iot-device-sdk')
const rc = require('rc')('aws')
const { random, round } = require('lodash')

const AWS_PROFILE = 'YOUR AWS PROFILE(CLI)'
const AWS_REGION = (rc[`profile ${AWS_PROFILE}`] || rc[AWS_PROFILE])['region']

AWS.config.credentials = new AWS.SharedIniFileCredentials({
  profile: AWS_PROFILE
})
AWS.config.region = AWS_REGION

const THING_NAME = 'temperature-sensor'
const FREQUENCE = 3000

const iotClient = new AWS.Iot()

const app = async () => {
  const { endpointAddress: iotEndpoint } = await iotClient.describeEndpoint().promise()
  const thing = await describeThing()
  const thingShadows = awsIot.thingShadow({
    host: iotEndpoint,
    profile: AWS_PROFILE,
    protocol: 'wss',
  });
  thingShadows.on('connect', () => {
    console.log('IoT connected')
    thingShadows.register(thing.thingName, () => {
      setInterval(() => {
        thingShadows.update(thing.thingName, {
          name: 'my',
          state: {
            reported: {
              temperature: round(
                random(24.0, 25.0, true),
                2
              )
            }
          }
        })
      }, FREQUENCE)
    })
    thingShadows.on('status', (thingName, stat, clientToken, stateObject) => {
      console.log('status', thingName, stat, clientToken, stateObject)
    })
  })
}

const describeThing = async () => {
  try {
    await iotClient.createThing({
      thingName: THING_NAME
    }).promise()
  } catch (error) {
    console.log(error)
  }
  return await iotClient.describeThing({
    thingName: THING_NAME
  }).promise()
}

app();

