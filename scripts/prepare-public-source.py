#!/usr/bin/env python3
"""Make an unpublished source snapshot. No Git, profile, network or release mutation."""
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import tarfile
from pathlib import Path, PurePosixPath

ROOT_FILES = {'.gitignore', 'README.md', 'DESIGN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
              'index.js', 'cordis.patch.yml', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json'}
ROOT_DIRS = {'src', 'scripts', 'test', 'docs', 'examples', 'fixtures', 'third-party-licenses', 'management-plugin'}
EXCLUDED = {'.git', '.agent', '.dsh', 'node_modules', 'dist', 'coverage', '__pycache__', '.DS_Store'}
PRIVATE_NAMES = {'runtime.key', 'admin.key', 'channel.key', 'state.json', 'browser-state.json',
                 'ego-binding.json', 'ego-binding-intent.json', 'health.url', 'setup.lock', 'runtime.lock'}
GENERATED = {'management-plugin/runtime', 'management-plugin/third-party-licenses',
             'management-plugin/THIRD_PARTY_NOTICES.md'}
OMITTED_REPORTS = {'docs/test-results.tap', 'docs/demo-results.tap', 'docs/check-results.txt', 'docs/package-dry-run.json'}
OMITTED_DEMO_IMAGES = {'docs/first-connection-demo/desktop.png', 'docs/first-connection-demo/workspace.png',
                       'docs/first-connection-demo/mobile-key.png'}
REPORT_LINK = re.compile(r'\[([^\]]+)\]\((?:\./)?(?:docs/)?(?:test-results\.tap|demo-results\.tap|check-results\.txt|package-dry-run\.json)\)')
MAX_FILE = 8 * 1024 * 1024
KEY = re.compile(rb'\bsk-[A-Za-z0-9_-]{20,}')
TUNNEL = re.compile(rb'\btunnel_[A-Za-z0-9]{20,128}\b')
PLUGIN = re.compile(rb'\bplugin_asdk_app_[A-Za-z0-9_-]{8,128}\b')
ORGANIZATION = re.compile(rb'\borg-[A-Za-z0-9]{16,128}\b')
WORKSPACE = re.compile(rb'\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b')
INSTALL = re.compile(rb'\bdsh-dot-[a-f0-9]{32}\b')
SYNTHETIC_TUNNEL = b'tunnel_' + b'1234567890abcdef' * 2
PRIVATE_REFERENCE = re.compile(r'\.dsh/(?:acceptance/|ego-first-connection-[0-9]+/|fresh-onboarding-[0-9]+/|ux-audit-[0-9]+/|onboarding-[0-9]+/|management-fix-)[A-Za-z0-9_./-]*')


def synthetic_key(value):
    return value.startswith(b'sk-synthetic') or value == b'sk-' + b'a' * 32 or value == b'sk-private-' + b'do-not-return'


def synthetic_uuid(path, value):
    common = {b'-'.join([b'12345678', b'1234', b'1234', b'1234', ending]) for ending in (b'123456789abc', b'123456789012')}
    common |= {b'-'.join([letter * 8, letter * 4, letter * 4, letter * 4, letter * 12]) for letter in (b'e', b'f')}
    if value in common or re.fullmatch(rb'00000000-0000-4000-8000-00000000000[236789]', value):
        return True
    return path == 'test/native-tasks.test.mjs' and value in {b'-'.join([b'a8f6fed7', b'5186', b'4912', b'a254', b'206f9236392' + suffix]) for suffix in (b'1', b'2', b'3', b'4')}


def findings_for(path, data, depth=0):
    findings = []
    def add(kind):
        finding = {'path': path, 'kind': kind}
        if finding not in findings:
            findings.append(finding)
    is_test = path.startswith('test/')
    if (b'/Users/' + b'shan/') in data or (b'/home/' + b'shan/') in data:
        add('personal_home')
    if (b'piggy' + b'00544') in data:
        add('retired_public_identity')
    if any(not (is_test and synthetic_key(value)) for value in KEY.findall(data)):
        add('secret_pattern')
    if any(not (is_test and value == SYNTHETIC_TUNNEL) for value in TUNNEL.findall(data)):
        add('private_tunnel_identity')
    for pattern, kind, allowed in [(PLUGIN, 'private_plugin_identity', lambda value: value.removeprefix(b'plugin_asdk_app_') in {b'synthetic12345678', b'owned123', b'1234567890abcdef', b'1234567890abcdff'}),
                                    (ORGANIZATION, 'private_organization_identity', lambda value: value.removeprefix(b'org-') in {b'1234567890abcdef', b'e' * 16, b'f' * 16}),
                                    (WORKSPACE, 'private_workspace_identity', lambda value: synthetic_uuid(path, value))]:
        if any(not (is_test and allowed(value)) for value in pattern.findall(data)):
            add(kind)
    if path.endswith('.zip'):
        add('unsupported_archive')
    if INSTALL.search(data):
        add('private_installation_identity')
    if path.endswith(('.tgz', '.tar.gz')):
        if depth >= 2:
            add('nested_archive_depth')
        else:
            try:
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
                    expanded = 0
                    for entry in archive:
                        parts = PurePosixPath(entry.name).parts
                        expanded += entry.size
                        if any(part in EXCLUDED or part in PRIVATE_NAMES or part.startswith('.env') for part in parts):
                            add('private_nested_file')
                            break
                        if entry.name.startswith('/') or '..' in parts or entry.issym() or entry.islnk() or expanded > 32 * MAX_FILE:
                            add('unsafe_nested_archive')
                            break
                        if entry.isfile():
                            if entry.size > MAX_FILE:
                                add('oversized_nested_file')
                                break
                            findings += findings_for(path + '::' + entry.name, archive.extractfile(entry).read(), depth + 1)
            except (tarfile.TarError, OSError):
                add('invalid_nested_archive')
    return findings


def export_source(root, output):
    if output.exists() or output.is_symlink():
        return {'passed': False, 'error': 'OUTPUT_EXISTS'}
    if output == root or any(output == root / item or root / item in output.parents for item in ROOT_DIRS):
        return {'passed': False, 'error': 'INVALID_OUTPUT'}
    pending, findings, redactions = {}, [], []
    def collect(path):
        relative = path.relative_to(root).as_posix()
        if any(part in EXCLUDED or part.startswith('.env') for part in path.relative_to(root).parts) or relative in GENERATED or relative in OMITTED_REPORTS or relative in OMITTED_DEMO_IMAGES:
            return
        if path.is_symlink():
            findings.append({'path': relative, 'kind': 'symlink'})
        elif path.is_dir():
            for child in sorted(path.iterdir()):
                collect(child)
        elif path.is_file():
            if path.name in PRIVATE_NAMES or path.name.endswith(('.log', '.pyc', '.key', '.pem', '.p12', '.pfx', '.db', '.sqlite', '.sqlite3')) or path.stat().st_size > MAX_FILE:
                findings.append({'path': relative, 'kind': 'private_or_oversized_file'})
                return
            data = path.read_bytes()
            if relative.startswith('docs/') and path.suffix == '.md':
                content = data.decode('utf-8')
                content, count = PRIVATE_REFERENCE.subn('[local private evidence omitted]', content)
                if count:
                    redactions.append({'path': relative, 'kind': 'private_evidence_reference', 'count': count})
                content, reports = REPORT_LINK.subn(r'\1 (local execution output omitted)', content)
                if reports:
                    redactions.append({'path': relative, 'kind': 'local_test_report_link', 'count': reports})
                data = content.encode('utf-8')
            findings.extend(findings_for(relative, data))
            pending[relative] = data
    for name in sorted(ROOT_FILES | ROOT_DIRS):
        path = root / name
        if path.exists() or path.is_symlink():
            collect(path)
    try:
        package = json.loads(pending['package.json'])
        native = json.loads(pending['management-plugin/package.json'])
        if package.get('name') != 'dot-dsh-connector' or native.get('name') != 'dot-dsh-management' or package.get('version') != native.get('version') or package.get('author') != '奥克斯木木山' or native.get('author') != '奥克斯木木山':
            raise ValueError('identity')
    except (KeyError, ValueError, TypeError):
        findings.append({'path': 'package.json', 'kind': 'package_identity'})
    if findings:
        return {'passed': False, 'error': 'PUBLIC_SOURCE_REJECTED', 'findings': findings}
    ignore = pending.get('.gitignore', b'').rstrip() + b'\n'
    for rule in (b'.agent/', b'.dsh/', b'node_modules/', b'dist/'):
        if rule not in ignore.splitlines():
            ignore += rule + b'\n'
    pending['.gitignore'] = ignore
    report = {'artifact_type': 'source_snapshot', 'publication_receipt': False, 'version': package['version'], 'author': package['author'], 'public_namespace': 'oxmumu3',
              'published': False, 'source_history_included': False, 'private_state_included': False,
              'redactions': redactions, 'omitted_local_reports': sorted(OMITTED_REPORTS),
              'omitted_legacy_demo_images': sorted(OMITTED_DEMO_IMAGES),
              'files': {path: hashlib.sha256(data).hexdigest() for path, data in sorted(pending.items())}}
    output.mkdir(mode=0o700, parents=False)
    try:
        for relative, data in pending.items():
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
        (output / 'PUBLIC_SOURCE_MANIFEST.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    except Exception:
        shutil.rmtree(output)
        raise
    return {'passed': True, 'version': package['version'], 'files': len(pending), 'redacted_documents': len(redactions),
            'published': False, 'source_history_included': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = export_source(args.root.resolve(strict=True), args.output.absolute())
    except (OSError, ValueError, UnicodeError, tarfile.TarError):
        result = {'passed': False, 'error': 'PUBLIC_SOURCE_EXPORT_FAILED'}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
