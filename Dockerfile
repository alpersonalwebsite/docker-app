FROM node:latest

# Metadata for the image
LABEL app="express-app"
# Set env variables key to value pair
ENV NPM_CONFIG_LOGLEVEL warn

# The app dir
WORKDIR /app

# Install dependencies
# * will refer to both, package and package-lock 
COPY package*.json ./

RUN npm install --production

# Bundle app source
COPY . .

EXPOSE 8080
CMD [ "npm", "start" ]