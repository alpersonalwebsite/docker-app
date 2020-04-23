pipeline {
  agent any

  environment {
    registry = 'you-aws-acc.dkr.ecr.us-east-1.amazonaws.com/web-app:latest'
  }

  tools {nodejs "node"}

  stages {

    stage('Build') {
      steps {
        sh 'npm install'
      }
    }

    stage('Lint JS') {
      steps {
        sh 'npm run lint'
      }
    }

    stage('Test JS') {
      steps {
        sh 'npm run test'
      }
    }

    stage('Build Docker Image') {
      steps {
        sh 'docker build -t web-app:latest .'
	  }
	}

    stage('Tag Docker Image') {
      steps {
        sh 'docker tag web-app:latest ${registry}'
	  }
	}

    stage('AWS Login') {
      steps {
        withAWS(credentials:'MyAWSCredentials', , region: 'us-east-1') {
            script {
                def login = ecrLogin()
                sh "${login}"
            }
        }
      }
    }

    stage('Push') {
      steps {
        sh 'docker push ${registry}'
	  }
	}

  }
}