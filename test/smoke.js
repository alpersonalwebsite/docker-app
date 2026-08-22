// A smoke test with no new dependencies: `assert` and `http` are both in the standard
// library. jest plus supertest would be the conventional choice and would also be four
// hundred packages, for three assertions, in a repo that deliberately keeps its 2020
// dependency set. The CircleCI workflow was already named build_test_deploy and had no
// test job, so this is the missing half of that name.
//
// Port 0 asks the OS for a free port, so the test never collides with a server the
// reader happens to have running on 8080.
const assert = require('assert');
const { spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const app = require('../app');

// Set-but-empty and whitespace-only are in this list on purpose: see constants.js.
const BAD_PORTS = ['99999', 'Infinity', '8080.5', '-1', 'abc', '', '   '];

// The five request assertions below, kept beside the list so the printed total stays honest.
const ROUTE_ASSERTIONS = 5;

// constants.js is checked in a child process because it reads process.env at require
// time, and a bad PORT is supposed to throw there rather than reach net.Server#listen,
// which would throw synchronously inside app.listen and so escape the error handler
// registered on the line after it.
const requireConstantsWith = (port) => spawnSync(
  process.execPath,
  ['-e', 'require("./constants")'],
  { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: port }, encoding: 'utf8' }
);

// DELETING the key, not setting it to '', because those are now different cases and the previous
// version of this test conflated them: it passed '' under a comment reading "Unset still falls back",
// which asserted the empty-string behaviour while claiming to assert the unset one.
const requireConstantsWithNoPort = () => {
  const env = { ...process.env };
  delete env.PORT;

  return spawnSync(
    process.execPath,
    ['-e', 'require("./constants")'],
    { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' }
  );
};

const get = (port, path) => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port, path }, (response) => {
    let body = '';

    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => resolve({ status: response.statusCode, body }));
  });

  request.on('error', reject);
});

const server = app.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();

  try {
    const root = await get(port, '/');
    assert.strictEqual(root.status, 200);
    assert.strictEqual(root.body, 'It is working!');

    const health = await get(port, '/healthz');
    assert.strictEqual(health.status, 200);
    assert.deepStrictEqual(JSON.parse(health.body), { status: 'ok' });

    // Express answers 404 for an unmatched route on its own. Asserting it catches the
    // case where a future catch-all route swallows everything and makes the two checks
    // above pass for the wrong reason.
    const missing = await get(port, '/does-not-exist');
    assert.strictEqual(missing.status, 404);

    // Every one of these reached net.Server#listen and threw a RangeError before
    // constants.js validated the value. The last two are set-but-empty: a variable that was
    // provided and produced nothing, which is a configuration mistake rather than an absent
    // setting, and which this file used to accept.
    BAD_PORTS.forEach((bad) => {
      const result = requireConstantsWith(bad);
      assert.strictEqual(result.status, 1, `PORT=${bad} should be rejected`);
      assert.ok(
        /PORT must be an integer between 1 and 65535/.test(result.stderr),
        `PORT=${bad} should say why, got: ${result.stderr.split('\n')[0]}`
      );
    });

    // Genuinely unset, which is the only case that falls back rather than throwing.
    assert.strictEqual(requireConstantsWithNoPort().status, 0);

    // Counted rather than written down, so adding a case cannot leave a stale number here.
    console.log(`smoke: ${ROUTE_ASSERTIONS + BAD_PORTS.length * 2 + 1} assertions passed`);
  } catch (error) {
    console.error(`smoke: FAILED ${error.message}`);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
