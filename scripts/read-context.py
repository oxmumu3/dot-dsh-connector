#!/usr/bin/env python3
"""Fixed bounded context reader; requires Python 3 and POSIX dir_fd/no-follow.

The Node caller uses execFile with isolated Python and JSON stdin, never a shell.
Only the exact listed relative files are opened. Directory descriptors keep each
lookup anchored even if a checked directory is renamed or replaced concurrently.
"""

import hashlib
import json
import os
import stat
import sys

REQUEST_LIMIT = 32768
FILE_LIMIT = 32768
TOTAL_LIMIT = 65536
SUPPORTED = (
    os.open in os.supports_dir_fd
    and all(hasattr(os, flag) for flag in ("O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK"))
)
DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)


class ContextError(Exception):
    pass


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {"root", "files"}:
        raise ContextError("Context path denied")
    root, paths = request["root"], request["files"]
    if (
        not isinstance(root, str)
        or not 1 <= len(root) <= 4096
        or not root.startswith("/")
        or root.startswith("//")
        or os.path.normpath(root) != root
        or "\\" in root
        or "\0" in root
    ):
        raise ContextError("Project root denied")
    if not isinstance(paths, list) or not 1 <= len(paths) <= 6:
        raise ContextError("Context path denied")
    for path in paths:
        if (
            not isinstance(path, str)
            or not 1 <= len(path) <= 300
            or "\\" in path
            or "\0" in path
            or any(part in ("", ".", "..") for part in path.split("/"))
        ):
            raise ContextError("Context path denied")
    return root, paths


def open_root(root):
    """Resolve even the configured root one no-follow component at a time."""
    current = os.open("/", DIR_FLAGS)
    try:
        for part in root.split("/")[1:]:
            if not part:  # Canonical / has no components.
                continue
            next_fd = os.open(part, DIR_FLAGS, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise


def read_file(root_fd, path, total):
    directory = os.dup(root_fd)
    leaf = None
    try:
        parts = path.split("/")
        for part in parts[:-1]:
            next_fd = os.open(part, DIR_FLAGS, dir_fd=directory)
            os.close(directory)
            directory = next_fd
        leaf = os.open(parts[-1], FILE_FLAGS, dir_fd=directory)
        info = os.fstat(leaf)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ContextError("Context must be an ordinary single-link file")
        if info.st_size > FILE_LIMIT or total + info.st_size > TOTAL_LIMIT:
            raise ContextError("Context exceeds byte limit")
        chunks, remaining = [], FILE_LIMIT + 1
        while remaining:
            chunk = os.read(leaf, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        if len(data) > FILE_LIMIT or total + len(data) > TOTAL_LIMIT:
            raise ContextError("Context exceeds byte limit")
        if os.fstat(leaf).st_nlink != 1:
            raise ContextError("Context must be an ordinary single-link file")
        try:
            text = data.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            raise ContextError("UTF-8 context required") from None
        if "\0" in text:
            raise ContextError("Binary context denied")
        return {"path": path, "text": text, "sha256": hashlib.sha256(data).hexdigest()}, len(data)
    finally:
        if leaf is not None:
            os.close(leaf)
        os.close(directory)


def read_context(request):
    if not SUPPORTED:
        raise ContextError("Context reader unavailable")
    root, paths = validate_request(request)
    root_fd = open_root(root)
    try:
        files, total = [], 0
        for path in paths:
            result, count = read_file(root_fd, path, total)
            files.append(result)
            total += count
        return {"files": files, "bytes": total}
    finally:
        os.close(root_fd)


def main():
    try:
        raw = sys.stdin.buffer.read(REQUEST_LIMIT + 1)
        if len(raw) > REQUEST_LIMIT:
            raise ContextError("Context exceeds byte limit")
        result = read_context(json.loads(raw.decode("utf-8", errors="strict")))
    except ContextError as error:
        result = {"error": str(error)}
    except (OSError, ValueError, UnicodeError):
        # Avoid returning filesystem paths, operating-system errors or source data.
        result = {"error": "Context path denied"}
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


if __name__ == "__main__":
    main()
