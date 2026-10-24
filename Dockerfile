# -------------------------------
# Stage 1: Dependencies
# -------------------------------
FROM node:22.23.4-alpine AS deps
WORKDIR /app

# Install dependencies only when needed
# Copy package files
COPY nextjs/package.json nextjs/package-lock.json* ./
RUN npm install
# RUN npm ci

# -------------------------------
# Stage 2: Builder
# -------------------------------
FROM node:22.23.4-alpine AS builder
WORKDIR /app

# Accept build arguments for version tracking
ARG GIT_COMMIT=unknown
ARG BUILD_TIMESTAMP
ARG APP_VERSION=2.0.0
ARG RUNTIME_ENV=production

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code (includes public folder)
COPY nextjs/ ./

# Verify public folder exists before build
RUN echo "Checking public folder before build:" && ls -la /app/public || echo "Public folder not found!"

# Set build-time environment variables for Next.js
# These will be embedded in the build output
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=${RUNTIME_ENV}
ENV NEXT_PUBLIC_GIT_COMMIT=${GIT_COMMIT}
ENV NEXT_PUBLIC_BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}

# Log build information
RUN echo "════════════════════════════════════════════" && \
    echo "Building ONIX v2 Web Scan" && \
    echo "════════════════════════════════════════════" && \
    echo "Version:    ${APP_VERSION}" && \
    echo "Commit ID:  ${GIT_COMMIT}" && \
    echo "Build Time: ${BUILD_TIMESTAMP}" && \
    echo "════════════════════════════════════════════"

# Build Next.js application
RUN npm run build

# Verify public folder exists after build
RUN echo "Checking public folder after build:" && ls -la /app/public || echo "Public folder missing after build!"

# -------------------------------
# Stage 3: Runner
# -------------------------------
FROM node:22.23.4-alpine AS runner
WORKDIR /app

# Accept runtime environment argument
ARG RUNTIME_ENV=production

# Set production environment
ENV NODE_ENV=${RUNTIME_ENV}
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy Next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public folder if it exists (Next.js standalone doesn't include it)
# We need to copy the entire directory including subdirectories
COPY --from=builder --chown=nextjs:nodejs /app/public ./public/

# Switch to non-root user
USER nextjs

# Expose port (default 5000, can be overridden at runtime)
EXPOSE ${PORT:-5000}

# Health check (using 0.0.0.0 to match Next.js listen address)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Start the application
# PORT will be read from environment variable at runtime, defaults to 5000 if not set
CMD ["sh", "-c", "PORT=${PORT:-5000} node server.js"]
