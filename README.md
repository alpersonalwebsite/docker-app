# Docker App
Simple `Express App` 

## Jenkins

- Launch an Ubuntu (t2.micro) EC2 instance.
- In the Security Group, Inbound, allow...
  - Port 22 (SSH) for Your IP
  - Port 8080 (Jenkins) for Your Ip
- Install JAVA Development Kit and Jenkins

```shell
ssh -i "JenkinsKP.pem" ubuntu@YOUR-EC2-PUBLIC-IP-OR-DNS
sudo apt-get update
sudo apt install -y default-jdk
wget -q -O - https://pkg.jenkins.io/debian/jenkins.io.key | sudo apt-key add -
#sudo sh -c 'echo deb https://pkg.jenkins.io/debian-stable binary/ > /etc/apt/sources.list.d/jenkins.list'
sudo sh -c 'echo deb http://pkg.jenkins-ci.org/debian binary/ > /etc/apt/sources.list.d/jenkins.list'
sudo apt-get update
sudo apt-get install -y jenkins
```

```shell
sudo su
yum update

yum install git

yum list "java-*-openjdk-devel"

yum install java-1.8.0-openjdk-devel.x86_64 

sudo wget -O /etc/yum.repos.d/jenkins.repo http://pkg.jenkins-ci.org/redhat-stable/jenkins.repo

sudo rpm --import https://jenkins-ci.org/redhat/jenkins-ci.org.key

sudo yum install jenkins

sudo service jenkins start # or systemctl enable jenkins
```

- Go to YOUR-EC2-PUBLIC-IP-OR-DNS:8080/
- Paste the code you will obtain as the result of executing `sudo cat /var/lib/jenkins/secrets/initialAdminPassword` in your EC2
- This is going to be the password to log into Jenkins. The user, `admin`
- Install the following plugins (... either through the `UI` or using `Jenkins CLI`)

  - Blue ocean
  - Common API for Blue Ocean
  - Config API for Blue Ocean
  - Dashboard for Blue Ocean
  - Events API for Blue OceAN
  - Git Pipeline for Blue Ocean
  - GitHub Pipeline for Blue Ocean
  - Pipeline implementation for Blue Ocean
  - Blue Ocean pipeline editor
  - Display URL for Blue Ocean
  - Blue Ocean Executor info
  - CloudBees AWS Credentials
  - Amazon ECR
  - NodeJS

- Re-start Jenkins: `sudo systemctl restart jenkins`

If you have issues with `git`, go to Manage Jenkins > Global Tool Configuration and set the path to executable. Example: `/bin/git`. You can check the path with `which git`

If you want to uninstall Jenkins
```
sudo service jenkins stop
sudo yum clean all
sudo yum -y remove jenkins
sudo rm -rf /var/cache/jenkins
sudo rm -rf /var/lib/jenkins/
```

- Re-start Jenkins: `sudo systemctl restart jenkins`

## Docker

```shell
sudo apt update

sudo apt install apt-transport-https ca-certificates curl software-properties-common

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu bionic stable"

sudo apt update

apt-cache policy docker-ce
```

We also need to add `Jenkins` to `docker group`
```shell
sudo usermod -a -G docker jenkins
```

- Start the daemon
`sudo service docker start`

- Check the service is running
`sudo service docker status`

- We can try to list containers (`docker ps`) and/or images (`docker image ls`), but we should not have any at the moment.

- We are going to download an image from [dockerhub](https://hub.docker.com/) for `node`: https://hub.docker.com/_/node. The official `Node.js` image. 
  - Pull the image: `docker pull node:latest`

- Now, having the `docker image` we are going to create a `container`: `docker run --name node-container -p 8000:8000 node:latest` 

## Amazon ECR
We are going to create a repository for our `dockerized app`

- Go to ECR: https://console.aws.amazon.com/ecr/repositories?region=us-east-1
  - Click on Create repository
    - Repository name: web-app
    - Your endpoint will be: your-aws-account-id.dkr.ecr.your-region.amazonaws.com/web-app

- You can also do it using `AWS cli`:
```shell
aws ecr create-repository --repository-name web-app

aws ecr describe-repositories --repository-name web-app #to get the repo uri
```

**IMPORTANT:** Remember that we are building the image, tagging it, logging into ECR and pushing the image to ECR through our `Jenkins pipeline` (Check `application` repo)


Yet, you can do the following (aka, manual process)...

```shell
# Login
# aws ecr get-login --no-include-email | sh
# This is preferred over the previous one. And we presuppose your region is us-east-1
aws ecr get-login-password --region us-east-1 \
    | docker login \
        --password-stdin \
        --username AWS \
        "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com"

# Expected result: Login Succeeded

# Build image
docker build --no-cache -t web-app:latest .

# Tag image
docker tag web-app:latest your-aws-account-id.dkr.ecr.us-east-1.amazonaws.com/web-app:latest

# Push image
docker push your-aws-account-id.dkr.ecr.us-east-1.amazonaws.com/web-app:latest
```

### Dockerize App

- Create `Dockerfile`
  We define the image that we are going to pull from `DockerHub`. It will be te same that we are utilizing in the next step: `node:latest`. Then, we create our app directory, install the dependencies, bundle our app source code inside the docker image (`COPY . .`), expose the port to connect and define the command that we will use to run our app (example: `node server.js`)
- Create `.gitignore` and `.dockerignore`
- Build the `docker image` (if you don't have the project, clone it: https://github.com/bunchito/application.git): `docker build --no-cache -t web-app .` Be sure docker daemon is running. 

- Now, if you run `docker images` you should see the `node` and `web-app` docker images
```shell
REPOSITORY                TAG                 IMAGE ID            CREATED             SIZE
web-app                   latest              f**********d        43 seconds ago      954MB
node                      latest              e**********2        14 hours ago        943MB
app                       latest              c**********a        4 weeks ago         1.25GB
```

- Run the image: `docker run -p 8080:8080 -d web-app`
Note: We can differentiate d from p (flags)
Example output: `231c***********************************************************9`

- Now, we can list our `running containers`: `docker ps`
Example output:
```shell
CONTAINER ID        IMAGE               COMMAND                  CREATED             STATUS              PORTS               NAMES
231c********        web-app             "docker-entrypoint.s…"   2 minutes ago       Up 2 minutes        8080/tcp            cranky_driscoll
```

- We can check the output of our `application` (aka, what we are logging into the console): `docker logs ********`
Example output:
```
Running on http://0.0.0.0:8080
```

- Now we can try our `dockerized app`: `curl -i http://localhost:9090`
Example output:
```shell
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: text/html; charset=utf-8
Content-Length: 14
ETag: W/"e-Soux3BO1zgKKRQAaqaQ2kVWUaFc"
Date: Wed, 22 Apr 2020 00:47:11 GMT
Connection: keep-alive

It is working!
```

Optional:
- If you want to remove the container: `docker rm --force ********`
- Now, you can make changes to your app and re-build the image: `docker build --no-cache -t web-app .` and then generate a new container: `docker run -p 8080:8080 -d web-app`.

### Jenkins pipeline for Docker App
Every time we make changes yto our source code, we want to re-build the `docker image`

- Configure `NodeJS` plugin: Manage Jenkins  > Global Tool Configuration 
  - Click on `Add NodeJS`
  - Name: `node`
  - Version: `NodeJS 14.0.0.0`

- Create Jenkins Pipeline 
  - Open Blue Ocean > Create a new Pipeline
  - Click on `GitHub`
  - Go to https://github.com/settings/tokens, generate a token and paste it (you need to be logged-in). For scopes -> repo: all checkboxes, admin repo hook: all checkboxes and user: just read and user email
  - Select your organization (example, your-GH-username)
  - Select the repository (example: application)
  - Create Pipeline

- Add AWS Credentials to Jenkins
  - Go to Credentials > Global > Add credentials
  - Select AWS credentials
  - Scope: global
  - Set an ID: MyAWSCredentials
  - Access Key ID: ****
  - Secret Access KEY: ****

- Add your ERC URI to to Jenkins Credentials as a `Secret Text`
  - Scope: global
  - Secret: your repo URI
  - ID: web-app-repo
  - Description: ECR URI web app

- Configure Docker Host URI
  - Go http://your-ec2-dns:8080/configureClouds/
  - Select Add a new cloud > Docker
  - Click on Docker Cloud Details
  - Docker Host URI: `tcp://172.17.0.40:2345`
  - Check `Enabled`
  - Click on `Apply`
  - Click on `Test Connection`

- Configure `CloudBees Credentials`
  - Go to Credentials > Global > Add credentials
  - Select AWS credentials
  - And set an ID: MyAWSCredentials
  - Access Key ID: ********
  - Secret Access KEY: ********