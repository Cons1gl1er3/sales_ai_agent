# Use a lightweight Node.js base image
FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package.json and pnpm-lock.yaml (if exists)
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install

# Copy source files
COPY . .

# Build TypeScript to JavaScript
RUN pnpm build

# Expose the WebSocket port (default: 8765)
EXPOSE 8765

# Start the application
CMD ["pnpm", "start"]