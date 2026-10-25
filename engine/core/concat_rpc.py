"""A bounded stdio client for Concat's built-in local MCP server."""

import json
from pathlib import Path
from queue import Empty, Queue
import subprocess
import tempfile
from threading import Thread
import time


class ConcatRPC:
    def __init__(self, binary: Path, env: dict[str, str]):
        self.binary = binary
        self.env = env
        self.sequence = 0
        self.messages: Queue = Queue()
        self.process = None
        self.errors = None

    def __enter__(self):
        self.errors = tempfile.TemporaryFile()
        try:
            self.process = subprocess.Popen(
                [str(self.binary), "--mcp", "headless"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self.errors,
                text=True,
                encoding="utf-8",
                env=self.env,
            )
            self.reader = Thread(target=self._read, daemon=True)
            self.reader.start()
            self.request(
                "initialize",
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "ShortForge", "version": "0.1.0"},
                },
                timeout=20,
            )
            self._write({"jsonrpc": "2.0", "method": "notifications/initialized"})
            return self
        except BaseException:
            self.close()
            raise

    def _read(self):
        try:
            while line := self.process.stdout.readline(2 * 1024 * 1024 + 1):
                if len(line) > 2 * 1024 * 1024:
                    raise RuntimeError("Concat returned an oversized response.")
                self.messages.put(json.loads(line))
        except Exception as exc:
            self.messages.put(exc)
        finally:
            self.messages.put(None)

    def _write(self, value: dict):
        try:
            self.process.stdin.write(json.dumps(value) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise RuntimeError(
                "Concat stopped while preparing the video. Try again."
            ) from exc

    def request(self, method: str, params: dict, *, timeout: float = 90) -> dict:
        self.sequence += 1
        identity = self.sequence
        self._write(
            {"jsonrpc": "2.0", "id": identity, "method": method, "params": params}
        )
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError(
                    "Concat took too long to prepare the video. Try again."
                )
            try:
                reply = self.messages.get(timeout=remaining)
            except Empty as exc:
                raise RuntimeError(
                    "Concat took too long to prepare the video. Try again."
                ) from exc
            if reply is None:
                raise RuntimeError(
                    "Concat stopped while preparing the video. Try again."
                )
            if isinstance(reply, Exception):
                raise RuntimeError(
                    "Concat returned an unreadable response. Try again."
                ) from reply
            if reply.get("id") != identity:
                continue
            if "error" in reply:
                raise RuntimeError(
                    reply["error"].get("message", "Concat refused the request.")
                )
            return reply.get("result", {})

    def call(self, name: str, arguments: dict | None = None) -> dict:
        result = self.request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
        if result.get("isError"):
            message = " ".join(
                item.get("text", "")
                for item in result.get("content", [])
                if item.get("type") == "text"
            )
            raise RuntimeError(message or "Concat could not prepare this video.")
        structured = result.get("structuredContent")
        if isinstance(structured, dict):
            return structured
        for item in result.get("content", []):
            if item.get("type") == "text":
                try:
                    value = json.loads(item["text"])
                except (ValueError, KeyError):
                    continue
                if isinstance(value, dict):
                    return value
        return {}

    def close(self):
        if self.process is not None:
            if self.process.stdin is not None:
                self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=3)
            if hasattr(self, "reader"):
                self.reader.join(timeout=1)
            if self.process.stdout is not None:
                self.process.stdout.close()
        if self.errors is not None:
            self.errors.close()

    def __exit__(self, *_):
        self.close()
