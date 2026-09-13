# syntax=docker/dockerfile:1

# ------------------------------------------------------------------------------
# Stage 1: Build React Web Frontend
# ------------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy frontend package manifests
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY . .
ENV VITE_TABULARIS_BACKEND_MODE=http
RUN pnpm build

# ------------------------------------------------------------------------------
# Stage 2: Build Rust Web Server
# ------------------------------------------------------------------------------
FROM rust:1.85-slim-bookworm AS backend-builder
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace crates
COPY src-core /app/src-core
COPY src-web-server /app/src-web-server

# Build web server in release mode
WORKDIR /app/src-web-server
RUN cargo build --locked --release --bin tabularis-web-server

# ------------------------------------------------------------------------------
# Stage 3: Secure Non-Root Runtime Container
# ------------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# Install CA certificates and runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root system user and group
RUN groupadd -g 10001 tabularis && \
    useradd -u 10001 -g tabularis -s /bin/false -m tabularis

WORKDIR /app

# Copy binary from backend builder
COPY --from=backend-builder /app/src-web-server/target/release/tabularis-web-server /usr/local/bin/tabularis-web-server
COPY --from=backend-builder /app/src-web-server/migrations /app/migrations

# Copy static frontend assets from frontend builder
COPY --from=frontend-builder /app/dist /app/dist

# Set file ownership
RUN chown -R tabularis:tabularis /app

# Drop to non-root user
USER tabularis

# Expose internal HTTP port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://127.0.0.1:3000/health/live || exit 1

ENTRYPOINT ["/usr/local/bin/tabularis-web-server"]
