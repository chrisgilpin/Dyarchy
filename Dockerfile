FROM node:20-slim AS build

WORKDIR /app

# Copy all package files
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

# Copy everything from build stage (includes node_modules with tsx)
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/tsconfig.base.json ./

EXPOSE 8080
ENV PORT=8080

CMD ["node", "--import", "tsx", "packages/server/src/index.ts"]
