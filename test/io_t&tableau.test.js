const { expect, matchTemplate, MatchStyle } = require('@aws-cdk/assert');
const cdk = require('@aws-cdk/core');
const IoT&tableau = require('../lib/io_t&tableau-stack');

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new IoT&tableau.IoT&tableauStack(app, 'MyTestStack');
    // THEN
    expect(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
