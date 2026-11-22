# Small shortcuts; every target is also documented as ordinary commands in README.
.PHONY: help native native-dev demo demo-mail demo-stop dev-db api web build test integration fmt
help:
	@echo "native: Docker-free demo | native-dev: Docker-free React hot reload (Ctrl+C stops both)"
	@echo "dev-db: PostgreSQL | api: Go API | web: React dev server"
	@echo "build: production assets/binary | test: unit/contract tests | integration: DB tests"
	@echo "demo: local dashboard + test email | demo-mail: another conversation | demo-stop: keep data and stop"
# Native commands own their database/processes; Ctrl+C stops them and keeps data.
native:
	python3 scripts/native_demo.py
native-dev:
	python3 scripts/native_demo.py --dev
# Docker is an alternative; its launcher preserves the existing .env and data.
demo:
	python3 scripts/local_demo.py
demo-mail:
	python3 scripts/send_demo_mail.py
demo-stop:
	docker compose --profile demo down
dev-db:
	docker compose up -d db
api:
	cd backend && go run ./cmd/server
web:
	cd frontend && npm run dev
build:
	cd frontend && npm ci && npm run build
	cd backend && go build -o ../bin/postharbor ./cmd/server
test:
	cd backend && go test ./...
	cd frontend && npm test
integration:
	@test -n "$$TEST_DATABASE_URL" || (echo "Set TEST_DATABASE_URL to a disposable PostgreSQL database"; exit 1)
	cd backend && go test -race ./...
fmt:
	cd backend && gofmt -w .
