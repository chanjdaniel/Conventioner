FROM node:20-alpine

WORKDIR /app

# Create a non-root user
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

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
