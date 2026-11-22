# Build the browser app once; the production container does not run Node.js.
FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Build a self-contained Go executable. Mail delivery is a separate Stalwart service.
FROM golang:1.27-alpine AS backend
WORKDIR /build/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/postharbor ./cmd/server

# Non-root runtime with trusted CA roots for HTTPS calls to Stalwart.
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S postharbor && adduser -S -G postharbor postharbor
WORKDIR /app
COPY --from=backend /out/postharbor /usr/local/bin/postharbor
COPY --from=frontend /build/frontend/dist ./public
ENV HTTP_ADDR=0.0.0.0:8080 STATIC_DIR=/app/public
USER postharbor
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
CMD ["postharbor"]
