# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy shared contracts first
COPY frameforge-shared-contracts/package*.json ./shared-contracts/
COPY frameforge-shared-contracts/tsconfig.json ./shared-contracts/
COPY frameforge-shared-contracts/src ./shared-contracts/src/

# Build shared contracts
WORKDIR /app/shared-contracts
RUN npm ci && npm run build

# Copy api-gateway files
WORKDIR /app/api-gateway
COPY frameforge-api-gateway/package*.json ./
RUN npm ci

COPY frameforge-api-gateway/src ./src/
COPY frameforge-api-gateway/tsconfig.json ./
RUN npm run build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache tini

# Set up shared contracts directory
WORKDIR /app/shared-contracts
COPY --from=builder /app/shared-contracts/package*.json ./
COPY --from=builder /app/shared-contracts/dist ./dist/

# Set up api-gateway directory
WORKDIR /app/api-gateway
COPY frameforge-api-gateway/package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

COPY --from=builder /app/api-gateway/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
