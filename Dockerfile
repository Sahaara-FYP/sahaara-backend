# Build: docker build -t sahaara-backend .
# Run: docker run -d -p 5000:5000 --name sahaara-backend sahaara-backend

# Stage 1: Build
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache build-base python3

WORKDIR /app

# Copy package files and .env for build-time prisma generation
COPY package*.json ./
COPY prisma ./prisma/
COPY .env ./

# Install all dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Copy .env and clean it for Linux (strips Windows \r)
COPY .env ./
RUN apk add --no-cache dos2unix && dos2unix .env

# Environment variables
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

# Start the application using Node's built-in env loader (bypasses dangerous shell expansion)
CMD ["node", "--env-file=.env", "dist/index.js"]
