pipeline {
  agent any

  // None of this was here, and all four matter on a t2/t3 instance with an 8 GiB root
  // volume. disableConcurrentBuilds is the load-bearing one: two runs of the old
  // pipeline both built web-app:latest and both pushed :latest, so whichever finished
  // second won and the tag no longer told you which commit was in the registry.
  options {
    timeout(time: 20, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    AWS_REGION = 'us-east-1'
    // Replace with your account ID. The ECR repository name is the last path segment.
    ECR_ACCOUNT = '123456789012'
    IMAGE_NAME = 'web-app'
    REGISTRY_HOST = "${ECR_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    REGISTRY = "${ECR_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${IMAGE_NAME}"
  }

  tools { nodejs 'node' }

  stages {

    stage('Install') {
      steps {
        // npm ci, not npm install: there is a lockfile and this is CI, which is the
        // exact case npm ci exists for.
        sh 'npm ci'
      }
    }

    stage('Lint') {
      steps {
        sh 'npm run lint'
      }
    }

    // The old pipeline had no test stage, and no tests to run in one.
    stage('Test') {
      steps {
        sh 'npm test'
      }
    }

    stage('Build image') {
      steps {
        // Tag with the short commit SHA as well as latest, so the registry records
        // which commit is deployed and a rollback is possible. Read from git rather
        // than env.GIT_COMMIT, which is unset outside a multibranch/SCM job.
        script {
          env.IMAGE_TAG = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
        }
        sh 'docker build -t "$IMAGE_NAME:$IMAGE_TAG" .'
      }
    }

    stage('Push to ECR') {
      // Blue Ocean's GitHub flow creates a multibranch job, so BRANCH_NAME is set. A
      // plain single-branch Pipeline job leaves it unset and this stage is skipped,
      // which is the safe direction to fail.
      when { branch 'master' }
      steps {
        // No credentials: block, and no AWS credential stored in Jenkins at all. The
        // instance carries an IAM role, so the CLI picks up short-lived rotated
        // credentials from instance metadata. See the README for the policy.
        //
        // get-login-password piped into --password-stdin, rather than the Amazon ECR
        // plugin's ecrLogin() or `aws ecr get-login`. Jenkins runs sh steps with -x, so
        // any command that takes the token as an argument prints the token into the
        // build log. Piped on stdin it never appears in an argument list.
        sh '''
          aws ecr get-login-password --region "$AWS_REGION" \
            | docker login --username AWS --password-stdin "$REGISTRY_HOST"

          docker tag "$IMAGE_NAME:$IMAGE_TAG" "$REGISTRY:$IMAGE_TAG"
          docker tag "$IMAGE_NAME:$IMAGE_TAG" "$REGISTRY:latest"

          docker push "$REGISTRY:$IMAGE_TAG"
          docker push "$REGISTRY:latest"
        '''
      }
    }
  }

  post {
    always {
      // The login writes credentials into ~/.docker/config.json on the agent, so log
      // out even when a stage failed. || true because logout is an error if the push
      // stage never logged in.
      sh 'docker logout "$REGISTRY_HOST" || true'
      cleanWs()
    }
  }
}
