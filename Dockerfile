# Build stage
FROM node:20-alpine AS builder

WORKDIR /build

# Copy and build shared contracts first
COPY frameforge-shared-contracts/package*.json ./frameforge-shared-contracts/
COPY frameforge-shared-contracts/tsconfig.json ./frameforge-shared-contracts/
COPY frameforge-shared-contracts/src ./frameforge-shared-contracts/src/

WORKDIR /build/frameforge-shared-contracts
RUN npm install && npm run build

# Copy api-gateway files
WORKDIR /build/frameforge-api-gateway
COPY frameforge-api-gateway/package*.json ./
COPY frameforge-api-gateway/tsconfig.json ./
RUN npm install

COPY frameforge-api-gateway/src ./src/
RUN npm run build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Copy built shared contracts
COPY --from=builder /build/frameforge-shared-contracts/package*.json ./frameforge-shared-contracts/
COPY --from=builder /build/frameforge-shared-contracts/dist ./frameforge-shared-contracts/dist/

# Set up api-gateway directory
WORKDIR /app/frameforge-api-gateway
COPY frameforge-api-gateway/package*.json ./
RUN npm install --only=production && \
    npm cache clean --force

COPY --from=builder /build/frameforge-api-gateway/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
