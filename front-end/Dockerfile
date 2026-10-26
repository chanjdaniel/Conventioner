# The Node .nvmrc pins, and the npm it bundles (docs/TECH_STACK.md#node-and-npm-are-pinned).
FROM node:24.22.1-alpine

# Create a non-root user (using 1001 to avoid conflicts with base image)
RUN addgroup -g 1001 appuser && \
    adduser -D -u 1001 -G appuser appuser

# The work directory is appuser's before anything is written into it, so `npm ci` writes
# node_modules as appuser once, instead of as root followed by a `chown -R` layer that copies it.
WORKDIR /app
RUN chown appuser:appuser /app
USER appuser

# Copy package files
COPY --chown=appuser:appuser package*.json ./

# Install dependencies, with the npm package.json's `engines` names: a base image that has
# drifted from .nvmrc's Node, and so bundles another npm, fails the build here.
RUN npm ci --engine-strict

# Copy application code
COPY --chown=appuser:appuser . .

# Expose port
EXPOSE 5173

# Start development server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
