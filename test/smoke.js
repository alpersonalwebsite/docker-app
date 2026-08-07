// A smoke test with no new dependencies: `assert` and `http` are both in the standard
// library. jest plus supertest would be the conventional choice and would also be four
// hundred packages, for three assertions, in a repo that deliberately keeps its 2020
// dependency set. The CircleCI workflow was already named build_test_deploy and had no
// test job, so this is the missing half of that name.
//
// Port 0 asks the OS for a free port, so the test never collides with a server the
// reader happens to have running on 8080.
const assert = require('assert');
const http = require('http');

const app = require('../app');

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

    console.log('smoke: 5 assertions passed');
  } catch (error) {
    console.error(`smoke: FAILED ${error.message}`);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
