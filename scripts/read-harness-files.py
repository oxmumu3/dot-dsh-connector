#!/usr/bin/env python3
"""Fixed, read-only, descriptor-anchored workspace file operations."""
import json
import os
import stat
import sys

MAX_FILE = 4 * 1024 * 1024
DENIED = {'.git', '.ssh', '.kube', '.config', '.aws', '.azure', '.gnupg', '.dsh', '.codex', '.openclaw',
          '.npmrc', '.pypirc', '.netrc', '.pgpass', '.docker', 'credentials',
          '.git-credentials', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
          'credentials.json', '.credentials.json', 'auth.json', 'tokens.json', 'cookies', 'login data',
          'web data', 'settings.local.json', 'keychains', 'com.tencent.xinwechat'}


def safe(parts):
    for part in parts:
        name = part.lower()
        if name in DENIED or name.startswith('.env') or name.startswith('credentials'):
            return False
        if name.endswith(('.pem', '.key', '.p12', '.pfx', '.jks', '.keychain-db', '.sqlite', '.sqlite3', '.db')):
            return False
    return True


def parts(value, empty=False):
    if not isinstance(value, str) or len(value) > 4096 or '\\' in value or '\0' in value:
        raise ValueError()
    if not value and empty:
        return []
    result = value.split('/')
    if any(not p or p in ('.', '..') for p in result) or not safe(result):
        raise ValueError()
    return result


def run(request):
    if set(request) != {'root', 'path', 'operation', 'internal'} or request['operation'] not in ('list', 'read') or request['internal'] not in ('none', 'context', 'instructions'):
        raise ValueError()
    root = request['root']
    if not isinstance(root, str) or not root.startswith('/') or root.startswith('//'):
        raise ValueError()
    ancestry = root[1:].split('/')
    safe_ancestry = safe(ancestry)
    if request['internal'] == 'context' and len(ancestry) >= 2 and ancestry[-2] == '.dsh' and ancestry[-1] in ('memory', 'skills'):
        safe_ancestry = safe(ancestry[:-2])
    instructions = request['internal'] == 'instructions'
    if instructions:
        if ancestry[-1] not in ('.dsh', '.agents') or request['path'] != ('' if request['operation'] == 'list' else 'AGENTS.md'):
            raise ValueError()
        safe_ancestry = safe(ancestry[:-1])
    if any(not p or p in ('.', '..') for p in ancestry) or not safe_ancestry:
        raise ValueError()
    relative = parts(request['path'], empty=request['operation'] == 'list')
    descriptors = []
    try:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        current = os.open('/', flags)
        descriptors.append(current)
        for name in ancestry + (relative if request['operation'] == 'list' else relative[:-1]):
            current = os.open(name, flags, dir_fd=current)
            descriptors.append(current)
        if request['operation'] == 'list':
            entries = []
            with os.scandir(current) as iterator:
                for item in iterator:
                    if instructions and item.name != 'AGENTS.md':
                        continue
                    if len(entries) >= 10000:
                        raise ValueError()
                    if not safe([item.name]):
                        continue
                    info = item.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode) and not instructions:
                        entries.append({'name': item.name, 'type': 'directory'})
                    elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                        entries.append({'name': item.name, 'type': 'file', 'size': info.st_size})
            return {'entries': sorted(entries, key=lambda e: e['name'])}
        fd = os.open(relative[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=current)
        descriptors.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_FILE:
            raise ValueError()
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(65536, MAX_FILE + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE:
                raise ValueError()
            chunks.append(chunk)
        after = os.fstat(fd)
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError()
        data = b''.join(chunks)
        if b'\0' in data:
            raise ValueError()
        return {'text': data.decode('utf-8', errors='strict'), 'source_bytes': len(data)}
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


try:
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError()
    print(json.dumps(run(json.loads(raw)), ensure_ascii=False))
except Exception:
    print(json.dumps({'error': 'Workspace file denied or unavailable'}))
