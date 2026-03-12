FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install gosu for running commands as non-root user
RUN wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/1.17/gosu-$(dpkg --print-architecture)" \
    && chmod +x /usr/local/bin/gosu \
    && gosu --version

# Upgrade pip to latest version (suppresses the notice)
RUN pip install --upgrade pip --no-cache-dir

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create a non-root user (suppresses the root user warning)
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

# Copy application code
COPY --chown=appuser:appuser . .

# Copy and set up entrypoint script
COPY --chown=appuser:appuser docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create necessary directories with proper permissions
RUN mkdir -p flask_session csv_exports && \
    chown -R appuser:appuser flask_session csv_exports

# Expose port
EXPOSE 5000

# Set environment variables
ENV FLASK_APP=app.py
ENV FLASK_ENV=development
ENV PYTHONUNBUFFERED=1

# Set entrypoint
ENTRYPOINT ["/docker-entrypoint.sh"]

# Run Flask with HTTPS (entrypoint will switch to appuser)
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000", "--cert=adhoc"]
