#!/usr/bin/env python3
"""Start the local dashboard and mail catcher, then populate both with demo data.

Run from any directory with Python 3 and Docker Compose installed. This script
preserves an existing .env and database. It refuses live-provider configurations.
It uses subprocess argument lists instead of evaluating shell commands or .env.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ["docker", "compose", "-f", "compose.yml", "-f", "compose.demo.yml", "--profile", "demo"]


def run(command, *, capture=False, env=None):
    """Run one command at the project root and stop on failure.

    Compose configuration contains credentials, so captured output is never
    printed. Child scripts receive local bootstrap credentials through env only.
    """
    return subprocess.run(
        command, cwd=ROOT, check=True, text=True, capture_output=capture, env=env
    )


def main():
    """Check prerequisites, start healthy services, and seed the local preview."""
    if shutil.which("docker") is None:
        raise SystemExit("Install Docker Desktop/Engine with Compose, then run this script again.")
    try:
        run(["docker", "info", "--format", "{{.ServerVersion}}"], capture=True)
        run(COMPOSE + ["version"], capture=True)
    except subprocess.CalledProcessError:
        raise SystemExit(
            "Docker is not ready. Open Docker Desktop (or start Docker Engine), "
            "wait until it is running, then retry. Docker Compose v2 is required."
        ) from None

    env_path = ROOT / ".env"
    if not env_path.exists():
        shutil.copyfile(ROOT / ".env.example", env_path)
        print("Created local .env from .env.example.", flush=True)

    try:
        # Ask Compose for the effective configuration, including exported env
        # overrides, instead of maintaining a second .env parser.
        configuration = json.loads(run(COMPOSE + ["config", "--format", "json"], capture=True).stdout)
        app_env = configuration["services"]["app"]["environment"]
        origin = app_env["APP_ORIGIN"]
        if app_env["MAIL_PROVIDER"] != "simulation":
            raise SystemExit("Local demo requires MAIL_PROVIDER=simulation. No services were started.")
        if origin not in ("http://localhost:8080", "http://127.0.0.1:8080"):
            raise SystemExit(
                "Set APP_ORIGIN=http://localhost:8080 for this Docker demo. "
                "For Vite hot reload, use docs/LOCAL_TESTING.md instead."
            )
        if not app_env.get("BOOTSTRAP_PASSWORD"):
            raise SystemExit("Set a local BOOTSTRAP_PASSWORD in .env before running the demo.")

        print("Building and starting the dashboard, database, and Mailpit…", flush=True)
        run(COMPOSE + ["up", "--build", "--detach", "--wait", "--wait-timeout", "180"])

        # The seed script only accepts simulation and local .test domains.
        seed_env = os.environ.copy()
        seed_env.update({
            "BASE_URL": origin,
            "BOOTSTRAP_EMAIL": app_env["BOOTSTRAP_EMAIL"],
            "BOOTSTRAP_PASSWORD": app_env["BOOTSTRAP_PASSWORD"],
        })
        run([sys.executable, str(ROOT / "scripts/seed_demo.py")], env=seed_env)
        run([sys.executable, str(ROOT / "scripts/send_demo_mail.py")])
    except subprocess.CalledProcessError:
        print(
            "\nDemo setup did not finish. Inspect: docker compose --profile demo logs --tail=50\n"
            "Existing database data was kept. Changing .env does not reset an existing owner password.\n"
            "If you changed that password in the UI, set BOOTSTRAP_PASSWORD to it for demo seeding.",
            file=sys.stderr,
        )
        return 1

    print(f"\nDashboard: {origin}")
    print(f"Owner: {app_env['BOOTSTRAP_EMAIL']} (password from your .env)")
    print(f"Your mailbox: {origin}/mail")
    print("Mailbox login: alex@harbor.test / local-mailbox-password")
    print("Mailpit diagnostics (all captured messages): http://localhost:8025")
    print("Stop services and keep data: docker compose --profile demo down")
    return 0


if __name__ == "__main__":
    sys.exit(main())
