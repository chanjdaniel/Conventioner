FROM node:20-alpine

WORKDIR /app

# Create a non-root user (using 1001 to avoid conflicts with base image)
RUN addgroup -g 1001 appuser && \
    adduser -D -u 1001 -G appuser appuser

# Copy package files
COPY --chown=appuser:appuser package*.json ./

# Install dependencies as root (needed for npm ci)
RUN npm ci

# Copy application code
COPY --chown=appuser:appuser . .

# Change ownership of node_modules (created by npm ci)
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 5173

# Start development server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
