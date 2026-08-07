# Docker App

[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](https://opensource.org/licenses/MIT)

A three-file Express app whose point is everything around it: a `Dockerfile` that
produces an image you would be willing to run, and **two** pipelines that build that
image and push it to Amazon ECR, one in Jenkins and one in CircleCI, so you can compare
them on the same job.

Originally written in **April 2020**. The app is unchanged in behaviour and the
dependency versions are deliberately frozen there. The infrastructure walkthrough is not
frozen: the AWS console, Jenkins' installation procedure and the AWS CLI have all moved,
so the commands below are the ones that work today, and where something changed
materially it is called out.

## The app

| File | Role |
| --- | --- |
| `app.js` | the Express app, two routes, exports it and binds nothing |
| `server.js` | binds the port, handles a failed bind, handles SIGTERM |
| `constants.js` | `PORT` and `HOST` from the environment, with defaults |
| `test/smoke.js` | mounts `app.js` on an ephemeral port and asserts against it |

`app.js` and `server.js` used to be one file, and that is why there were no tests:
`require('./server')` took port 8080 as a side effect of the import, so nothing could
mount the app twice or on a port of its own choosing.

```shell
npm ci          # not npm install: there is a lockfile, at lockfileVersion 1
npm start
npm test
npm run lint
```

```shell
curl -i http://localhost:8080/
curl -s http://localhost:8080/healthz
```

`/healthz` exists for the container health check, so that a probe and a real request are
distinguishable in the logs.

## Building and running the image

```shell
docker build -t web-app:latest .
docker run -d -p 8080:8080 --name web-app web-app:latest

docker ps                       # STATUS shows (healthy) after a few seconds
docker logs web-app             # Running on http://0.0.0.0:8080
curl -s http://localhost:8080/  # It is working!

docker stop web-app && docker rm web-app
```

### What the Dockerfile does, and why each line is there

**`FROM node:14.21.3-alpine`, not `node:latest`.** `latest` is a moving tag: it resolves
to **Node 26.7.0** as of writing, twelve major versions past the Node 14 that this
project targets and that the Jenkins NodeJS tool below configures. The version your image
runs then changes without a commit, which is the opposite of what an image is for. Pinning
to alpine also takes the image from **1.27 GB to 120 MB**, measured on the two builds, and
the base ships the same npm 6.14.18.

**`npm ci --only=production`, not `npm install --production`.** There is a
`package-lock.json` in the build context. `npm install` is allowed to resolve past it;
`npm ci` installs exactly what it pins and fails if the lockfile and the manifest
disagree. `--only=production` is npm 6 syntax, which is what this base image has (npm 7
renamed it to `--omit=dev`).

**`USER node`.** The container used to run as root, verified with `docker run --rm
web-app id` returning `uid=0(root)`. The official Node images already ship an
unprivileged `node` user at uid 1000, and nothing here needs more.

**Named `COPY`, and a real `.dockerignore`.** The old `.dockerignore` had two entries,
`node_modules` and `npm-debug.log`, so `COPY . .` shipped `.git` (164K of full history),
the `Jenkinsfile`, the CircleCI config and the README into an image being pushed to a
registry. Both are fixed: the Dockerfile copies the three source files by name, and
`.dockerignore` is a full list as defence in depth. Note that `docker build` transfers
the entire context to the daemon before the first instruction runs, so `.dockerignore`
earns its place either way.

**`HEALTHCHECK`.** busybox `wget` is already in the alpine image, so the check costs
nothing extra. It hits `/healthz` at the port `constants.js` reads, which is why `PORT`
is an `ENV` rather than a literal repeated in three files.

### Signals, which is the interesting part

`docker stop` sends SIGTERM and waits ten seconds before SIGKILL. A process running as
**PID 1 gets no default signal dispositions from the kernel**, so a SIGTERM it does not
explicitly handle is discarded. Measured on `node:14` with `docker stop`:

| CMD | stop time | exit code |
| --- | --- | --- |
| `["npm", "start"]` (what this repo used to do) | 0.15s | 0 |
| `["node", "server.js"]`, no signal handler | **10.24s** | **137** (SIGKILL) |
| `["node", "server.js"]` + `docker run --init` | 0.19s | 143 |
| `["node", "server.js"]` + an explicit handler | 0.17s | 0 |

So the common advice, "do not use `npm start` as your CMD, call node directly", makes
things **strictly worse** on its own: npm was the thing catching the signal. The handler
in `server.js` is what matters, and the CMD change just removes a process from the
middle. `server.close()` also drains in-flight responses, which is the difference between
a deploy that drops requests and one that does not.

`npm start` is not free of surprises either. On npm 11 the same container stops in 0.67s
but exits **1**, which an orchestrator reads as a crash rather than a clean stop.

### The other bug worth knowing

`server.js` used to log success it did not have:

```js
app.listen(PORT, HOST);
console.log(`Running on http://${HOST}:${PORT}`);
```

`app.listen` is asynchronous, so with port 8080 already taken the container printed

```text
Running on http://0.0.0.0:8080
events.js:377 ... EADDRINUSE
```

and exited 1. The README's own "check what we are logging" step used that exact line as
proof the container was working. The message is in the `listen` callback now, and there is
an `error` handler that says what went wrong in one line.

## Amazon ECR

```shell
aws ecr create-repository --repository-name web-app
aws ecr describe-repositories --repository-name web-app   # for the URI
```

Your registry URI is `<account-id>.dkr.ecr.<region>.amazonaws.com/web-app`.

### The IAM policy, which the old walkthrough did not have

Pushing an image needs six actions and no more. `ecr:GetAuthorizationToken` is the one
that cannot be scoped to a resource, because it does not act on one:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushWebApp",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/web-app"
    }
  ]
}
```

The old README attached nothing in particular and had you paste an access key, so in
practice the pipeline ran with whatever the key's owner could do.

### Logging in and pushing by hand

```shell
account=$(aws sts get-caller-identity --query Account --output text)
registry_host="${account}.dkr.ecr.us-east-1.amazonaws.com"

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin "$registry_host"

tag=$(git rev-parse --short HEAD)
docker build -t "web-app:${tag}" .
docker tag "web-app:${tag}" "${registry_host}/web-app:${tag}"
docker tag "web-app:${tag}" "${registry_host}/web-app:latest"
docker push "${registry_host}/web-app:${tag}"
docker push "${registry_host}/web-app:latest"

docker logout "$registry_host"
```

Two things changed here since 2020. **`aws ecr get-login` is gone** in AWS CLI v2, and it
was worth removing: it printed a `docker login -p <token>` command that you then
`eval`'d, so the token landed in your shell history, in the process list, and in any CI
log with command echoing on. `get-login-password` piped into `--password-stdin` never puts
it in an argument.

**The image is tagged with the commit SHA as well as `latest`.** Everything used to be
`:latest` only, which means the registry cannot tell you what is deployed and there is
nothing to roll back to.

## Jenkins

The pipeline is `Jenkinsfile`. Five stages: install, lint, test, build the image, and push
to ECR on `master` only.

### 1. An instance role, not an access key

The old walkthrough had you paste an AWS access key and secret into Jenkins, in two
separate places (once as *AWS Credentials*, then again at the very end under *Configure
CloudBees Credentials*, with the same ID). Jenkins here runs on EC2, which means it can
carry an **IAM role** and the AWS SDK will read short-lived, automatically rotated
credentials from instance metadata. There is then no long-lived secret to leak, rotate, or
paste into a screenshot, on a box whose entire job is running arbitrary shell.

Create a role with trusted entity **AWS service, EC2**, attach the ECR policy above, and
attach the role to the instance under **EC2 → Instances → Actions → Security → Modify IAM
role**. It takes effect immediately, with no restart.

The `Jenkinsfile` therefore stores no credential and names none. `aws ecr
get-login-password` finds the role through the default credential chain.

If you run Jenkins somewhere without instance metadata, that is the case where you do
need a key. Scope it to exactly the policy above and store it under **Manage Jenkins →
Credentials**.

### 2. Install Jenkins, Docker and the AWS CLI

**On Ubuntu:**

```shell
ssh -i ~/.ssh/JenkinsKP.pem ubuntu@YOUR-EC2-PUBLIC-IP-OR-DNS

sudo apt-get update
sudo apt-get install -y fontconfig openjdk-21-jre

sudo mkdir -p /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/jenkins-keyring.asc \
  https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] \
  https://pkg.jenkins.io/debian-stable binary/" \
  | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null

sudo apt-get update
sudo apt-get install -y jenkins
```

**On Amazon Linux 2023:**

```shell
sudo dnf install -y java-21-amazon-corretto-headless git

sudo curl -fsSL -o /etc/yum.repos.d/jenkins.repo \
  https://pkg.jenkins.io/redhat-stable/jenkins.repo
sudo rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2026.key

sudo dnf install -y jenkins
sudo systemctl enable --now jenkins
```

Both resolve Jenkins **2.568.2** as of writing. The old instructions do not, and it is
worth being precise about why, because most of the URLs still work:

- **The signing key no longer matches the repository.** The old steps fetched
  `pkg.jenkins.io/debian/jenkins.io.key` and ran `sudo apt-key add -`, which reports `OK`.
  `apt-get update` then fails with `NO_PUBKEY 7198F4B714ABFC68` and `The repository ... is
  not signed`, and `apt-get install jenkins` ends at `Package 'jenkins' has no installation
  candidate`. Jenkins has rotated its signing key since; the current one is the
  `jenkins.io-2026.key` above.
- **`apt-key` is deprecated**, and while it is still present on Ubuntu 24.04 it adds the
  key to the system-wide trusted keyring, so it is trusted for *every* repository rather
  than just Jenkins'. The `signed-by=` form above scopes it to one.
- **`default-jdk` is Java 11 on Ubuntu 20.04**, verified as `openjdk version "11.0.27"`,
  and current Jenkins LTS requires 17 or 21. It happens to be Java 21 on Ubuntu 24.04, so
  this one fails only on older releases, which is worse than failing everywhere.
- **`pkg.jenkins-ci.org` is not dead**, it redirects to `pkg.jenkins.io` in three hops, and
  the `redhat-stable` path now redirects to `rpm-stable`. The old URLs are not the problem.
- **The old `deb` line pointed at the weekly channel** (`/debian binary/`) while the
  commented-out line beside it pointed at `debian-stable`. Following it got you weekly
  builds on a machine you were not going to update.

The old README also had an unlabelled second block in `yum` pasted into the middle of the
Ubuntu walkthrough, and an uninstall section in `yum` after installing with `apt`. Those
are the two paths above now, each complete.

**Docker.** The old section never actually installed it: it ended at `apt-cache policy
docker-ce`, which only queries. Use Docker's own script, and put the Jenkins user in the
`docker` group so the pipeline's `docker build` works without sudo:

```shell
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker jenkins
sudo systemctl enable --now docker
sudo systemctl restart jenkins        # the new group only applies to new processes
```

Adding a user to the `docker` group is equivalent to giving it root, since it can
`docker run -v /:/host`. On a single-purpose Jenkins host that is the trade being made;
it is not something to do on a shared box.

**AWS CLI**, which the pipeline calls directly:

```shell
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install
aws sts get-caller-identity           # should show the instance role
```

### 3. Instance size and disk

The original said `t2.micro`, which has **1 GiB of memory**. Jenkins' own hardware
guidance asks for more than that for anything past a single user, and Java 21 plus Blue
Ocean is not a light footprint. It will boot and run this pipeline, which is why free-tier
walkthroughs reach for it, but expect it to be slow and to OOM occasionally during plugin
installation. `t3.small` (2 GiB) is a more honest floor.

Give it disk too. The console defaults to an **8 GiB root volume**, and this pipeline
builds Docker images, which is the fastest way to fill one. That is why the `Jenkinsfile`
sets `buildDiscarder` and calls `cleanWs()`, and it is worth adding a periodic
`docker image prune`.

Security group inbound: port 22 and port 8080 from **your IP only**, not `0.0.0.0/0`.
Jenkins on 8080 is unauthenticated until you finish the setup wizard.

### 4. Unlock, and the plugins that are actually needed

```shell
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```

Paste it at `http://YOUR-EC2-PUBLIC-IP:8080/`, then create your own admin user.

| Plugin | Provides | In *Install suggested plugins*? |
| --- | --- | --- |
| **NodeJS** | `tools { nodejs 'node' }` | no, install it |
| **Blue Ocean** | the pipeline UI, and the GitHub setup flow | no, install it |
| **Timestamper** | `timestamps()` | **yes** |
| **Workspace Cleanup** | `cleanWs()` | **yes** |

The last two come with the wizard's suggested set, so most readers already have them and
never notice. If you chose *Select plugins to install* and took only what a list like this
named, the build fails before the first stage with `No such DSL method 'timestamps'`, which
gives no hint that a plugin is the problem.

The old list was the eleven individual `... for Blue Ocean` plugins, which Blue Ocean pulls
in by itself, plus two that are no longer needed at all: **CloudBees AWS Credentials**,
because there is no stored credential, and **Amazon ECR**, because the pipeline logs in
with the AWS CLI rather than the plugin's `ecrLogin()`. That last one is deliberate:
Jenkins runs `sh` steps with `-x`, so a login command that takes the token as an argument
prints it into the build log.

`timeout()`, `buildDiscarder()` and `disableConcurrentBuilds()` need nothing extra. They
are core Pipeline.

Configure the Node version under **Manage Jenkins → Tools → NodeJS → Add NodeJS**, name
it `node` (the `Jenkinsfile` refers to it by that name) and pick **14.x**, matching the
Dockerfile's pin.

### 5. Create the pipeline

Blue Ocean → **New pipeline** → GitHub, authenticate with a token from
<https://github.com/settings/tokens>, and pick this repository. That creates a multibranch
job, which is what makes `when { branch 'master' }` on the push stage work.

Set `ECR_ACCOUNT` in the `Jenkinsfile`'s `environment` block to your account ID.

### What the old walkthrough had that is now gone

The **Docker Host URI** step, `tcp://172.17.0.40:2345` under *Manage Jenkins → Clouds*. An
unauthenticated, unencrypted Docker daemon socket is root on the host to anyone who can
reach the port, and this pipeline never needed it: `docker build`, `docker tag` and
`docker push` all run through the local CLI on the agent. It could not have worked as
written either, since Docker listens on 2375 (plain) or 2376 (TLS), and `172.17.0.40` is a
docker0 bridge address rather than anything reachable.

## CircleCI

`.circleci/config.yml`, same job in a different shape: `build`, then `lint` and `test` in
parallel, then `push` on `master` only.

CircleCI has no instance metadata, so this is the one place a long-lived key is
unavoidable. Set these as project environment variables, with the key scoped to exactly
the ECR policy above and nothing else:

| Variable | Value |
| --- | --- |
| `AWS_ACCOUNT_ID` | your account ID |
| `AWS_ACCESS_KEY_ID` | the CI user's key |
| `AWS_SECRET_ACCESS_KEY` | the CI user's secret |

Four things changed from the 2020 config:

- **The executor was `circleci/node:lts-browsers`.** A moving tag, so the Node under CI
  drifted with no commit, in the deprecated `circleci/` namespace, carrying a headless
  browser this project has no use for. It is `cimg/node:14.21.3` now, matching the
  Dockerfile.
- **`persist_to_workspace` persisted `src`**, which does not exist in this repository:
  every source file is at the root. The downstream jobs only appeared to work because
  `checkout` had already put the sources there.
- **There was no test job**, in a workflow named `build_test_deploy`.
- **`aws ecr get-login`** with a `sed` fixup, `eval`'d, which puts the token in the log.
  Replaced with `get-login-password --password-stdin`. The old step also ran
  `sudo apt-get install awscli` with no `apt-get update` first, and Ubuntu's `awscli`
  package is AWS CLI **v1** (candidate `1.18.69` on 20.04), which is the only reason
  `get-login` resolved at all: v2 removed it.

## What this walkthrough does not cover

- **Running the image anywhere.** It stops at a tagged image in ECR. ECS, EKS and
  App Runner all start from there and each is a different walkthrough.
- **Image scanning.** ECR can scan on push, and for an image pinned to Node 14 it will
  have plenty to say. The dependency versions here are deliberately frozen at 2020, so
  scanning is mentioned rather than enabled.
- **Jenkins behind anything.** It is on 8080, HTTP, reachable from your IP. A real setup
  puts it behind a reverse proxy with TLS.
- **Agents.** `agent any` means the controller builds it, which is fine for one image and
  not how you would run untrusted pipelines.
