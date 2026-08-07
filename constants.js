// Read from the environment with container-friendly defaults, so the same image can
// be run on a different port without a rebuild. The Dockerfile sets both, which also
// means EXPOSE and the HEALTHCHECK no longer repeat a number that lives here.
const PORT = Number(process.env.PORT) || 8080;

// 0.0.0.0, not localhost. This is the one line in the project that is genuinely
// Docker-specific: a server bound to 127.0.0.1 inside a container is reachable only
// from inside that container, so `docker run -p 8080:8080` publishes a port that
// nothing is listening on and `curl` from the host gets a connection reset.
const HOST = process.env.HOST || '0.0.0.0';

module.exports = { PORT, HOST };
