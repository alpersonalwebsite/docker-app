# Pinned, and pinned to the Node this project was written for. `node:latest` today
# resolves to Node 26, twelve major versions past the 14 that the Jenkins NodeJS tool
# in the README configures, and it changes under you without a commit. The alpine
# variant is the same Node 14.21.3 and npm 6.14.18 in a much smaller image.
FROM node:14.21.3-alpine

LABEL app="express-app"

# `ENV key value` is the legacy form and Docker now warns about it (LegacyKeyValueFormat).
# PORT and HOST are read by constants.js, so the port lives in exactly one place and
# EXPOSE and the HEALTHCHECK below both follow it.
ENV NPM_CONFIG_LOGLEVEL=warn \
    NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# The manifest and the lockfile on their own layer, before the source, so that editing
# server.js does not invalidate the install layer.
COPY package.json package-lock.json ./

# `npm ci`, not `npm install`. There is a lockfile right here and `npm install` is free
# to ignore it and resolve something newer; `npm ci` installs exactly what it pins and
# fails if the two disagree. --only=production is npm 6 syntax (npm 7 renamed it
# --omit=dev) and this image ships npm 6.14.18.
RUN npm ci --only=production && npm cache clean --force

# Named files rather than `COPY . .`. With the old two-line .dockerignore, `COPY . .`
# shipped .git (the whole history), the Jenkinsfile, the CircleCI config and the README
# into a public image. .dockerignore is fixed too, but an explicit list cannot be
# defeated by forgetting to add an entry to it later.
COPY app.js server.js constants.js ./

# The image already ships an unprivileged `node` user (uid 1000). Nothing here needs
# root, and the app writes nothing to disk at all.
USER node

EXPOSE 8080

# wget is busybox's, already in the alpine image, so this costs no extra layer. Shell
# form on purpose: ${PORT} has to be expanded at runtime.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

# Exec form, so node is PID 1 and receives SIGTERM directly. server.js handles it; see
# the measurements in the comment there for why the handler, not this line, is the part
# that makes `docker stop` fast.
CMD ["node", "server.js"]
