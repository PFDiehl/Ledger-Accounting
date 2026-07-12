FROM node:20-alpine

WORKDIR /app

# Install OpenSSL 1.1 required by Prisma
RUN apk add --no-cache openssl1.1-compat

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]

