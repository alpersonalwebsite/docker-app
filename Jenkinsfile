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
    IMAGE_NAME = 'web-app'
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
        // The account ID is read from STS rather than committed. A placeholder in this
        // file is a thing to forget: leave it unedited and the pipeline authenticates
        // against, and pushes to, whatever account 123456789012 is. Asking STS also
        // fails immediately and legibly when no role is attached.
        //
        // get-login-password piped into --password-stdin, rather than the Amazon ECR
        // plugin's ecrLogin() or `aws ecr get-login`. Jenkins runs sh steps with -x, so
        // any command that takes the token as an argument prints the token into the
        // build log. Piped on stdin it never appears in an argument list.
        sh '''
          account=$(aws sts get-caller-identity --query Account --output text)
          registry_host="${account}.dkr.ecr.${AWS_REGION}.amazonaws.com"
          registry="${registry_host}/${IMAGE_NAME}"

          # Log out however this block exits, so the credential does not survive in the
          # agent's ~/.docker/config.json after a failed push. Jenkins runs sh with -e,
          # so without a trap an error between login and the end skips the cleanup.
          trap 'docker logout "$registry_host" >/dev/null 2>&1 || true' EXIT

          aws ecr get-login-password --region "$AWS_REGION" \
            | docker login --username AWS --password-stdin "$registry_host"

          docker tag "$IMAGE_NAME:$IMAGE_TAG" "$registry:$IMAGE_TAG"
          docker tag "$IMAGE_NAME:$IMAGE_TAG" "$registry:latest"

          docker push "$registry:$IMAGE_TAG"
          docker push "$registry:latest"
        '''
      }
    }
  }

  post {
    always {
      // The logout lives in the push stage's own trap, next to the registry host it
      // needs, rather than here where the value would have to be recomputed.
      cleanWs()
    }
  }
}
