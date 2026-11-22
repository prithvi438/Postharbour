#!/usr/bin/env bash
# Build a Git revision in isolation; activate only after build/tests succeed.
# Run as root: bash /var/www/postharbor/repository/deploy/native/update.sh [revision]
set -euo pipefail
ROOT=/var/www/postharbor
REPO="$ROOT/repository"
export PATH=/opt/postharbor/go/bin:/opt/node-v24.22.3-linux-x64/bin:/usr/sbin:/usr/bin:/sbin:/bin
export GOTOOLCHAIN=local
if [[ $(id -u) != 0 ]]; then echo 'Run this deployment command as root.' >&2; exit 1; fi
# The runtime service has a read-only filesystem despite sharing the build user.
runuser -u postharbor -- git -C "$REPO" fetch origin main
REV=$(runuser -u postharbor -- git -C "$REPO" rev-parse --verify "${1:-origin/main}^{commit}")
RELEASE="$ROOT/releases/${REV:0:12}-$(date +%Y%m%d%H%M%S)"
install -d -o postharbor -g postharbor "$RELEASE"
runuser -u postharbor -- git -C "$REPO" archive "$REV" | runuser -u postharbor -- tar -x -C "$RELEASE"
runuser -u postharbor -- env PATH="$PATH" GOTOOLCHAIN=local bash -c '
    set -euo pipefail
    cd "$1/frontend"
    npm ci --no-audit --no-fund
    npm test
    npm run build
    cd ../backend
    go test ./...
    CGO_ENABLED=0 go build -trimpath -o ../server ./cmd/server
' bash "$RELEASE"
# Save the previous target for service rollback; database migrations are additive
# today, but future schema changes must be reviewed before rolling back binaries.
PREVIOUS=$(readlink "$ROOT/current" || true)
ln -s "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
systemctl restart postharbor
for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:8180/healthz >/dev/null; then
        echo "Healthy release: $REV"
        exit 0
    fi
    sleep 1
done
if [[ -n "$PREVIOUS" ]]; then
    ln -s "$PREVIOUS" "$ROOT/current.rollback"
    mv -Tf "$ROOT/current.rollback" "$ROOT/current"
    systemctl restart postharbor
fi
echo 'Release failed health check; inspect journalctl -u postharbor.' >&2
exit 1
