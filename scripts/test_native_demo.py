#!/usr/bin/env python3
"""Exercise native-launcher shutdown without PostgreSQL, builds, or real demo data.

Run with: python3 -m unittest discover -s scripts -p 'test_native_demo.py' -v
Each launcher owns temporary Python services; a separate sentinel must survive.
"""

import errno
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import native_demo


LAUNCHER = Path(__file__).with_name("native_demo.py").resolve()

# The worker has a grandchild in its process group. Both must stop, as npm/Vite
# descendants do in the real launcher. A short shutdown delay exposes repeat signals.
WORKER = r"""
import json, os, signal, subprocess, sys, time
from pathlib import Path
state = Path(sys.argv[1])
grandchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
def stop(signum, frame):
    (state / 'stopping').touch()
    time.sleep(0.4)
    grandchild.wait(timeout=3)
    (state / 'clean-shutdown').touch()
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
(state / 'worker-pids.json').write_text(json.dumps([os.getpid(), grandchild.pid]))
while True:
    time.sleep(1)
"""

# Import the actual launcher, replacing only heavyweight application setup.
# The UID override permits this dependency-free test in root-owned CI containers;
# it does not start PostgreSQL or change the real launcher's root refusal.
HARNESS = r"""
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('native_demo', sys.argv[1])
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)
demo.STATE = Path(sys.argv[2])
demo.os.geteuid = lambda: 1000
def start_demo(args, services):
    services.start('worker', [sys.executable, str(demo.STATE / 'worker.py'), str(demo.STATE)])
    services.wait_for(lambda: (demo.STATE / 'worker-pids.json').exists(), 'test worker')
    (demo.STATE / 'ready').touch()
demo.start_demo = start_demo
sys.argv = [str(demo.__file__)]
sys.exit(demo.main())
"""


def wait_until(predicate, description, timeout=10):
    """Bound each process check so a broken cleanup cannot hang the test suite."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError(f"Timed out waiting for {description}")


def process_exists(pid):
    """Probe only PIDs recorded by this test's temporary worker."""
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


@unittest.skipUnless(hasattr(signal, "SIGHUP"), "The native launcher targets macOS/Linux.")
class NativeShutdownTests(unittest.TestCase):
    """Real signals must clean owned groups while preserving unrelated services."""

    def check_shutdown(self, first_signal, repeat=False):
        """Run one isolated launcher, signal it, and verify process/lock ownership."""
        with tempfile.TemporaryDirectory(prefix="postharbor-shutdown-") as directory:
            state = Path(directory)
            (state / "worker.py").write_text(WORKER)
            sentinel = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(60)"],
                start_new_session=True,
            )
            launcher = subprocess.Popen(
                [sys.executable, "-c", HARNESS, str(LAUNCHER), str(state)],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                start_new_session=True,
            )
            worker_pids = []
            try:
                wait_until(lambda: (state / "ready").exists() or launcher.poll() is not None,
                           "launcher readiness")
                self.assertIsNone(launcher.poll(), "Test launcher failed before readiness")
                worker_pids = json.loads((state / "worker-pids.json").read_text())
                self.assertTrue(all(process_exists(pid) for pid in worker_pids))
                with (state / "launcher.lock").open("a") as lock:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                launcher.send_signal(first_signal)
                if repeat:
                    wait_until(lambda: (state / "stopping").exists(), "worker shutdown")
                    # Cleanup has begun but is deliberately not finished yet.
                    for extra_signal in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                        launcher.send_signal(extra_signal)
                output, _ = launcher.communicate(timeout=10)
                self.assertEqual(launcher.returncode, 0, output)
                self.assertTrue((state / "clean-shutdown").exists(), output)
                wait_until(lambda: not any(process_exists(pid) for pid in worker_pids),
                           "owned worker and grandchild exit")
                self.assertIsNone(sentinel.poll(), "Unrelated process was stopped")
                with (state / "launcher.lock").open("a") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                # Test failures must not leave their own temporary services behind.
                for pid in ([launcher.pid] if launcher.poll() is None else []) + worker_pids[:1]:
                    try:
                        os.killpg(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                launcher.communicate(timeout=5)
                sentinel.terminate()
                sentinel.wait(timeout=5)

    def test_terminal_and_process_signals_stop_owned_services(self):
        """Terminal hangup, Ctrl+C, and termination share the same clean shutdown."""
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=signal.Signals(signum).name):
                self.check_shutdown(signum)

    def test_repeated_signals_do_not_interrupt_cleanup(self):
        """A second hangup or Ctrl+C cannot abandon still-stopping children."""
        self.check_shutdown(signal.SIGHUP, repeat=True)


class NativePortTests(unittest.TestCase):
    """Port checks distinguish running services, recently closed TCP, and OS errors."""

    def test_live_listener_is_rejected_even_with_address_reuse(self):
        """Restart support must never permit takeover of a listening service."""
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            with self.assertRaisesRegex(RuntimeError, "is in use"):
                native_demo.free_port(listener.getsockname()[1])

    def test_permission_error_is_not_reported_as_an_occupied_port(self):
        """Preserve permission failures so troubleshooting names the actual cause."""
        with mock.patch.object(native_demo.socket, "socket") as factory:
            listener = factory.return_value.__enter__.return_value
            listener.bind.side_effect = PermissionError(errno.EACCES, "Test bind denied")
            with self.assertRaises(PermissionError) as caught:
                native_demo.free_port(12345)
            self.assertEqual(caught.exception.errno, errno.EACCES)

    def test_recently_closed_tcp_connection_does_not_block_restart(self):
        """An active server-side close leaves TIME_WAIT without a live listener."""
        with socket.socket() as listener, socket.socket() as client:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            client.settimeout(3)
            client.connect(("127.0.0.1", port))
            with listener.accept()[0] as connection:
                connection.shutdown(socket.SHUT_WR)
                self.assertEqual(client.recv(1), b"")
        # Demonstrate the original failure before checking the corrected probe.
        with socket.socket() as plain_probe:
            with self.assertRaises(OSError) as caught:
                plain_probe.bind(("127.0.0.1", port))
            self.assertEqual(caught.exception.errno, errno.EADDRINUSE)
        native_demo.free_port(port)


if __name__ == "__main__":
    unittest.main()
