#!/usr/bin/env python3
"""Run the complete local demo on macOS/Linux without Docker or system services.

Prerequisites: Python 3, Go >=1.25, Node >=22.12, PostgreSQL >=16, and Mailpit.
The default serves built React/PWA assets; --dev starts Vite with hot reload.
All runtime data stays in .local-demo/. Ctrl+C stops only this launcher's children.
"""

import argparse
import errno
import fcntl
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / ".local-demo"
DB_PORT = 55432


def executable(name, override=None):
    """Locate a prerequisite without installing software or changing the user's PATH."""
    path = shutil.which(override or name)
    if path is None:
        raise RuntimeError(f"Missing {name}. Follow docs/NATIVE_DEVELOPMENT.md to install prerequisites.")
    return path


def run(command, *, cwd=ROOT, env=None, capture=False):
    """Run a build or setup step, preserving ordinary logs but never printing secrets."""
    return subprocess.run(command, cwd=cwd, env=env, text=True, check=True, capture_output=capture)


def free_port(port):
    """Reject occupied ports instead of connecting to or stopping another application."""
    with socket.socket() as listener:
        # Match the servers' restart behavior: recently closed TCP connections
        # can remain in TIME_WAIT even though no service is listening anymore.
        # SO_REUSEADDR permits that restart; it cannot replace a live listener.
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
            raise RuntimeError(
                f"Local port {port} is in use. Stop the other local instance and retry. "
                "See the occupied-port recovery steps in docs/NATIVE_DEVELOPMENT.md."
            ) from None


class Services:
    """Own child process groups and their logs, so shutdown also stops Vite/npm children."""

    def __init__(self):
        """Start with no owned processes; never adopt an existing system service."""
        self.children = []

    def start(self, name, command, *, env=None, cwd=ROOT, stop_signal=signal.SIGTERM):
        """Start one service in a separate process group with a private local log."""
        log = (STATE / f"{name}.log").open("a")
        try:
            child = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=log, start_new_session=True)
        except BaseException:
            log.close()
            raise
        self.children.append((name, child, log, stop_signal))

    def check(self):
        """Fail early if any service exited; the matching log explains the error."""
        for name, child, _, _ in self.children:
            if child.poll() is not None:
                raise RuntimeError(f"{name} exited. Inspect {STATE / (name + '.log')}")

    def wait_for(self, probe, description):
        """Wait up to 30 seconds for real readiness while watching process failures."""
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            self.check()
            if probe():
                return
            time.sleep(0.2)
        raise RuntimeError(f"Timed out waiting for {description}. Inspect logs in {STATE}.")

    def stop(self):
        """Stop children in reverse order; PostgreSQL uses a clean fast shutdown."""
        for _, child, log, stop_signal in reversed(self.children):
            try:
                os.killpg(child.pid, stop_signal)
                child.wait(timeout=15)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            finally:
                log.close()


def http_ready(url):
    """Check a loopback HTTP endpoint without routing it through environment proxies."""
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=1) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def database_password():
    """Persist a random local DB password privately; restarts reuse the same credential."""
    path = STATE / "database-password"
    if not path.exists():
        with open(path, "x", opener=lambda name, flags: os.open(name, flags, 0o600)) as file:
            file.write(secrets.token_hex(24) + "\n")
    return path, path.read_text().strip()


def start_demo(args, services):
    """Build the application, initialize an isolated DB, and start the local demo."""
    go = executable("go", os.environ.get("GO_BIN"))
    node = executable("node")
    npm = executable("npm")
    mailpit = executable("mailpit", os.environ.get("MAILPIT_BIN"))
    pg_bin = os.environ.get("PG_BIN", "")
    postgres = {name: executable(name, str(Path(pg_bin) / name) if pg_bin else None)
                for name in ("initdb", "postgres", "psql", "createdb")}
    version = tuple(map(int, run([node, "--version"], capture=True).stdout.strip().lstrip("v").split(".")[:2]))
    if version < (22, 12):
        raise RuntimeError("Node.js 22.12+ is required. Put a supported Node version first in PATH.")
    go_version = run([go, "version"], capture=True).stdout
    match = re.search(r"go(\d+)\.(\d+)", go_version)
    if not match or tuple(map(int, match.groups())) < (1, 25):
        raise RuntimeError("Go 1.25 or newer is required.")
    pg_version = run([postgres["postgres"], "--version"], capture=True).stdout
    pg_match = re.search(r"PostgreSQL\) (\d+)", pg_version)
    if not pg_match or int(pg_match.group(1)) < 16:
        raise RuntimeError("PostgreSQL 16 or newer is required.")
    for port in (DB_PORT, 8080, 8025, 1025) + ((5173,) if args.dev else ()):
        free_port(port)

    print("Preparing the native application…", flush=True)
    if args.install or not (ROOT / "frontend/node_modules/.package-lock.json").exists():
        run([npm, "ci"], cwd=ROOT / "frontend")
    if not args.dev:
        run([npm, "run", "build"], cwd=ROOT / "frontend")
    binary = STATE / "postharbor"
    run([go, "build", "-o", str(binary), "./cmd/server"], cwd=ROOT / "backend")

    password_file, password = database_password()
    data = STATE / "postgres"
    if not (data / "PG_VERSION").exists():
        run([postgres["initdb"], "-D", str(data), "-U", "postharbor", "--encoding=UTF8",
             "--no-locale", "--auth=scram-sha-256", "--pwfile=" + str(password_file)])
    # Ignore inherited PostgreSQL connection settings; this launcher owns its DB.
    pg_env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    pg_env.update(PGHOST="127.0.0.1", PGPORT=str(DB_PORT), PGUSER="postharbor",
                  PGPASSWORD=password, PGDATABASE="postgres", PGSSLMODE="disable")
    services.start("postgres", [postgres["postgres"], "-D", str(data), "-h", "127.0.0.1",
                               "-p", str(DB_PORT), "-k", ""], env=pg_env, stop_signal=signal.SIGINT)

    def database_ready():
        """Test authenticated SQL readiness, not merely an open TCP socket."""
        result = subprocess.run([postgres["psql"], "-X", "-tAc", "SELECT 1"], env=pg_env,
                                text=True, capture_output=True, timeout=3)
        return result.returncode == 0

    services.wait_for(database_ready, "PostgreSQL")
    exists = run([postgres["psql"], "-X", "-tAc",
                  "SELECT 1 FROM pg_database WHERE datname = 'postharbor'"], env=pg_env, capture=True).stdout.strip()
    if not exists:
        run([postgres["createdb"], "postharbor"], env=pg_env)

    # Removing inherited Mailpit settings prevents accidentally enabling a relay.
    mail_env = {key: value for key, value in os.environ.items() if not key.startswith("MP_")}
    services.start("mailpit", [mailpit, "--listen", "127.0.0.1:8025", "--smtp", "127.0.0.1:1025",
                              "--database", str(STATE / "mailpit.db"), "--disable-version-check",
                              "--allowed-hosts", "localhost,127.0.0.1", "--max", "200",
                              "--label", "Postharbor native demo"], env=mail_env)
    origin = "http://localhost:5173" if args.dev else "http://localhost:8080"
    app_env = os.environ.copy()
    app_env.update(DATABASE_URL=f"postgres://postharbor:{password}@127.0.0.1:{DB_PORT}/postharbor?sslmode=disable",
                   HTTP_ADDR="127.0.0.1:8080", APP_ORIGIN=origin, MAIL_PROVIDER="simulation",
                   STATIC_DIR=str(ROOT / "frontend/dist"), BOOTSTRAP_EMAIL="owner@example.test",
                   BOOTSTRAP_PASSWORD=os.environ.get("NATIVE_OWNER_PASSWORD", "local-development-password"),
                   MAX_MAILBOXES="5", MAIL_HOST="mail.harbor.test", WEBMAIL_URL="",
                   MAILPIT_URL="http://127.0.0.1:8025",
                   STALWART_URL="", STALWART_TOKEN="", BASE_URL=origin)
    services.start("api", [str(binary)], env=app_env)
    services.wait_for(lambda: http_ready("http://127.0.0.1:8080/healthz"), "the API")
    services.wait_for(lambda: http_ready("http://127.0.0.1:8025/readyz"), "Mailpit")
    if args.dev:
        services.start("vite", [npm, "run", "dev", "--", "--port", "5173", "--strictPort"], cwd=ROOT / "frontend")
    services.wait_for(lambda: http_ready(origin), "the dashboard")
    if not args.no_seed:
        run([sys.executable, str(ROOT / "scripts/seed_demo.py")], env=app_env)
        run([sys.executable, str(ROOT / "scripts/send_demo_mail.py")])
        if args.check:
            run([sys.executable, str(ROOT / "scripts/check_webmail.py")], env=app_env)
    print(f"\nAdmin dashboard: {origin}\nYour mailbox: {origin}/mail\n"
          "Mailbox login: alex@harbor.test / local-mailbox-password\n"
          "Mailpit diagnostics (all captured mail): http://localhost:8025\n"
          "Owner: owner@example.test (default password: local-development-password)\n"
          "Use your current password if you changed it.\n"
          "Ctrl+C stops these services and keeps your data in .local-demo/.\n"
          "Use /mail to read, compose, and reply to local test email.", flush=True)


def main():
    """Hold an exclusive launcher lock and clean up on Ctrl+C, failure, or --check."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", action="store_true", help="Run React with Vite hot reload on port 5173.")
    parser.add_argument("--install", action="store_true", help="Run npm ci again after dependency changes.")
    parser.add_argument("--no-seed", action="store_true", help="Resume existing data without logging in or adding sample email.")
    parser.add_argument("--check", action="store_true", help="Verify startup and demo seeding, then stop automatically.")
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error("Run as your normal user, not sudo/root; PostgreSQL cannot run as root.")
    STATE.mkdir(mode=0o700, exist_ok=True)
    services = Services()

    def interrupt(signum, frame):
        """Translate terminal termination into the same cleanup path as Ctrl+C."""
        raise KeyboardInterrupt

    # Child services have their own sessions. A terminal hangup must therefore
    # ask this launcher to stop them explicitly, just as Ctrl+C does.
    shutdown_signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    for signum in shutdown_signals:
        signal.signal(signum, interrupt)
    with (STATE / "launcher.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("The native demo is already running. Use its terminal to stop it.", file=sys.stderr)
            return 1
        try:
            start_demo(args, services)
            while not args.check:
                services.check()
                time.sleep(1)
            return 0
        except KeyboardInterrupt:
            print("\nStopping native demo…", flush=True)
            return 0
        except (RuntimeError, OSError, subprocess.SubprocessError) as error:
            # Do not print command environments: they contain the DB password.
            print(f"\nNative demo stopped: {error}\nSee docs/NATIVE_DEVELOPMENT.md and .local-demo/*.log.", file=sys.stderr)
            return 1
        finally:
            # A second Ctrl+C or terminal-close signal must not interrupt the
            # shutdown loop before it reaches PostgreSQL (the last child stopped).
            handlers = {signum: signal.signal(signum, signal.SIG_IGN)
                        for signum in shutdown_signals}
            try:
                services.stop()
            finally:
                for signum, handler in handlers.items():
                    signal.signal(signum, handler)


if __name__ == "__main__":
    sys.exit(main())
