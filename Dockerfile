# Use a lightweight Node.js base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package.json ./
COPY package-lock.json* ./

# Install production dependencies
RUN npm ci --only=production

# Copy source files
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Expose the WebSocket port (default: 8765)
EXPOSE 8765

# Start the application
CMD ["npm", "start"]