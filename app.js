// The Express app, and nothing else. Binding a port is server.js's job.
//
// This used to be one file, and requiring it started a listener as a side effect,
// which is why there was no test: `require('./server')` from a test would have taken
// port 8080 for the duration of the process. Splitting the two means the test can
// mount the same app on an ephemeral port.
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('It is working!');
});

// A separate endpoint for the Dockerfile's HEALTHCHECK, so that a health probe and a
// real request are distinguishable in the logs, and so the check keeps working if `/`
// ever grows a redirect or an auth guard.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
