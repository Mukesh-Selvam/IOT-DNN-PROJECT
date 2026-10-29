FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 5055

CMD ["node", "src/index.js", "--no-repl"]
