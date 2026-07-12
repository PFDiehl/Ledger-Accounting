FROM node:20-alpine

WORKDIR /app

# Install OpenSSL (v3) required by Prisma on Alpine
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]

