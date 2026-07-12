FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]