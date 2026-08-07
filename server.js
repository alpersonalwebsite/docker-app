const app = require('./app');
const { HOST, PORT } = require('./constants');

// The success message goes in the listen callback, not after the call. `app.listen` is
// asynchronous, so the old code logged "Running on http://0.0.0.0:8080" and then died
// on the next tick if the port was taken. The README's own "check the logs" step used
// that line as proof the container was working.
const server = app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});

// Without this handler the EADDRINUSE arrives as an uncaught exception and the reader
// gets a stack trace where one line would do.
server.on('error', (error) => {
  console.error(`Cannot listen on ${HOST}:${PORT}: ${error.message}`);
  process.exitCode = 1;
});

// Shut down on the signal `docker stop` sends, and this is worth more than a line of
// explanation because the usual advice about it is wrong.
//
// A process running as PID 1 gets no default signal dispositions from the kernel, so a
// SIGTERM it does not explicitly handle is discarded. Docker then waits out its grace
// period and SIGKILLs. Measured on node:14 with `docker stop`:
//
//   CMD                                     stop time   exit code
//   ["npm", "start"]                            0.15s   0
//   ["node", "server.js"], no handler          10.24s   137 (SIGKILL)
//   ["node", "server.js"] + docker run --init   0.19s   143
//   ["node", "server.js"] + this handler        0.17s   0
//
// So "call node directly instead of npm" on its own makes shutdown ten seconds slower
// and turns every stop into a kill, because npm is what was catching the signal. The
// handler is the part that matters; the CMD change just removes a process from the
// middle. (`npm start` is also not free of surprises: on npm 11 the same container
// stops in 0.67s but exits 1, which an orchestrator reads as a crash.)
//
// server.close stops accepting new connections and waits for in-flight responses to
// finish, which is the difference between a deploy that drops requests and one that
// does not.
const shutdown = (signal) => {
  console.log(`${signal} received, closing the server`);

  server.close((error) => {
    if (error) {
      console.error(`Error while closing: ${error.message}`);
      process.exit(1);
    }

    process.exit(0);
  });
};

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});
