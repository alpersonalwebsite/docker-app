// Read from the environment with container-friendly defaults, so the same image can
// be run on a different port without a rebuild. The Dockerfile sets both, which also
// means EXPOSE and the HEALTHCHECK no longer repeat a number that lives here.

const DEFAULT_PORT = 8080;

// Validated, not just coerced. `Number(process.env.PORT) || 8080` accepts anything
// truthy, and net.Server#listen then throws a RangeError *synchronously*, which means
// it happens inside the app.listen call in server.js, before the line below it that
// registers the error handler. So the handler cannot catch it and the reader gets a
// stack trace. Measured, all four throwing:
//
//   PORT=99999    -> 99999      RangeError: options.port should be >= 0 and < 65536
//   PORT=Infinity -> Infinity   RangeError (Number.isInteger is false)
//   PORT=8080.5   -> 8080.5     RangeError
//   PORT=-1       -> -1         RangeError
//
// ONLY UNSET falls back to the default. Set-but-invalid throws here instead, with a message
// naming the variable, because silently falling back would turn a typo in a deployment config
// into a service listening on the wrong port.
//
// An empty or whitespace-only value counts as invalid, not as absent: something put that
// variable there and produced nothing, which is a configuration mistake worth saying out loud.
// This used to special-case `value === ''` and fall back, while a whitespace-only value threw,
// and the inconsistency was accidental rather than intended: `Number('   ')` is 0, which fails
// the range check below, whereas `''` never reached it. Measured before the change:
//
//   PORT unset   -> 8080, exit 0
//   PORT=""      -> 8080, exit 0     silently defaulted
//   PORT="   "   -> exit 1           threw, for the reason above rather than by design
//
// Two identical situations behaving differently, so the `=== ''` clause is gone and both now
// throw. This also aligns with the readers in node-express-mongo-redis,
// node-express-postgresql-docker-compose and basic-apollo-graphql, which were written with this
// reasoning from the start and which this file diverged from.
const readPort = (value) => {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(
      `PORT must be an integer between 1 and 65535, received ${JSON.stringify(value)}`
    );
  }

  return port;
};

const PORT = readPort(process.env.PORT);

// 0.0.0.0, not localhost. This is the one line in the project that is genuinely
// Docker-specific: a server bound to 127.0.0.1 inside a container is reachable only
// from inside that container, so `docker run -p 8080:8080` publishes a port that
// nothing is listening on and `curl` from the host gets a connection reset.
const HOST = process.env.HOST || '0.0.0.0';

module.exports = { PORT, HOST };
