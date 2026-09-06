# Build the client and compile the server, then ship one small runtime image.
FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 downloads a prebuilt binary; the toolchain is only a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV AEO_DATA_DIR=/app/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
VOLUME ["/app/data"]
EXPOSE 3400
CMD ["node", "server/dist/index.js"]
