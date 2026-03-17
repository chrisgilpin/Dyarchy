FROM node:20-slim AS build

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/

# Install all dependencies
RUN npm install

# Copy source
COPY . .

# Build client (Vite) and copy to server/public
RUN npm run build

# ---- Production stage ----
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Install production + dev deps (need tsx for runtime)
RUN npm install --workspaces

# Copy source and built static files
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY --from=build /app/packages/server/public packages/server/public

EXPOSE 8080
ENV PORT=8080

CMD ["node", "--import", "tsx", "packages/server/src/index.ts"]
