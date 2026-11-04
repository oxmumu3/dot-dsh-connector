"""Run exact public-SDK contracts with synthetic HOME and a hard network boundary."""
import argparse, json, os, re, signal, subprocess, sys, tempfile, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = ['compatibility-gate', 'runtime-compatibility', 'native-loop', 'executor', 'isolated-host', 'management-native', 'management-compat', 'management', 'management-host', 'management-ui', 'management-bridge', 'management-errors', 'codec-compatibility']

def bounded(command, env, log, timeout):
    with log.open('w') as stream:
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['sdk', 'carrier', 'out', 'node', 'official']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--inside', action='store_true')
    args = parser.parse_args()
    assert sys.version_info >= (3, 10), 'Python3.10+ is required for descriptor-safe fixtures'
    out = Path(args.out).resolve(); out.mkdir(parents=True, exist_ok=True)
    if not args.inside:
        inner = [sys.executable, str(Path(__file__).resolve()), '--inside', '--sdk', args.sdk, '--carrier', str(Path(args.carrier).resolve()), '--out', str(out), '--node', str(Path(args.node).resolve()), '--official', str(Path(args.official).resolve())]
        if sys.platform == 'darwin':
            profile = out / 'network.sb'
            profile.write_text('(version 1)\n(allow default)\n(deny network*)\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n(deny file-read* file-write* (subpath "/Applications"))\n(deny process-exec (subpath "/Applications"))\n')
            command = ['/usr/bin/sandbox-exec', '-f', str(profile), *inner]
        elif sys.platform == 'linux':
            # Only fixed system tools run as root. Drop UID/GID before repository code.
            setup = 'set -eu\n/usr/sbin/ip link set lo up\ntask_uid=$1\ntask_gid=$2\nshift 2\nexec /usr/bin/setpriv --reuid "$task_uid" --regid "$task_gid" --clear-groups --no-new-privs "$@"'
            command = ['sudo', '-n', '--', '/usr/bin/unshare', '--net', '--', '/bin/sh', '-c', setup, 'dsh-ci-netns', str(os.getuid()), str(os.getgid()), *inner]
        else:
            raise RuntimeError('No supported hard network sandbox; refusing unsandboxed tests')
        return subprocess.run(command, cwd=ROOT, timeout=220, check=False).returncode
    home = Path(tempfile.mkdtemp(prefix='dsh-ci-synthetic-home-')).resolve()
    python_path = str(Path(shutil.which('python3') or sys.executable).parent)
    env = {'PATH': str(Path(args.node).parent) + ':' + python_path + ':/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(home), 'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_DATA_HOME': str(home / '.local/share'), 'DSH_HOME': str(home / 'dsh'), 'DSH_AGENTS_HOME': str(home / 'agents'), 'TMPDIR': tempfile.gettempdir(), 'LANG': 'en_US.UTF-8', 'DSH_TELEMETRY_DISABLED': '1', 'DSH_TEST_SDK_ROOT': str(Path(args.carrier).resolve()), 'DSH_TEST_NATIVE_SDK_ROOT': str(Path(args.carrier).resolve()), 'DSH_OFFICIAL_VERSIONS_FILE': str(Path(args.official).resolve())}
    proof = out / 'network-proof.json'
    assert bounded([args.node, str(ROOT / 'scripts/ci/network-proof.mjs')], env, proof, 10) == 0, 'Hard network sandbox probe failed'
    test_files = ['test/' + name + '.test.mjs' for name in SUITE]
    command = [args.node, '--import', str(ROOT / 'scripts/ci/preload.mjs'), '--max-old-space-size=128', '--test', '--test-reporter=tap', '--test-concurrency=1', *test_files]
    log = out / 'contracts.tap'; status = bounded(command, env, log, 180)
    text = log.read_text(); counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', text, re.M)}
    result = {'sdk': args.sdk, 'platform': sys.platform, 'counts': counts, 'suiteFiles': test_files, 'network': json.loads(proof.read_text()), 'syntheticHome': True, 'dailyDesktopUsed': False, 'desktopOnboardingVerified': False}
    (out / 'contracts-proof.json').write_text(json.dumps(result, indent=2) + '\n'); print(json.dumps(result), flush=True)
    assert status == 0 and counts.get('tests', 0) >= 156 and counts.get('pass') == counts.get('tests') and counts.get('fail') == 0 and counts.get('skipped') == 0 and counts.get('cancelled') == 0, 'Public SDK contract suite failed, incomplete, or skipped'
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
