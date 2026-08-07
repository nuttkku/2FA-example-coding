FROM node:20-alpine

# Picks up OS package security patches released after this base image was
# published (e.g. an OpenSSL fix) instead of relying solely on whatever was
# baked in at the time - caught by Trivy image scanning in CI.
RUN apk update && apk upgrade --no-cache

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN chown -R node:node /app

USER node

EXPOSE 5173

CMD ["npm", "run", "dev"]
