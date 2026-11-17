"""Operate disposable Fabric candidates with a separate PM2 daemon."""
import argparse
import fcntl
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = pathlib.Path('/opt/fabric-candidate')
STATE = pathlib.Path('/var/lib/fabric-candidates')
PRODUCTION = pathlib.Path('/opt/fabric')

ISOLATION_CHECK = r"""
const fs = require('node:fs');
const dotenv = require('/opt/fabric/node_modules/dotenv');
const mysql = require('/opt/fabric/node_modules/mysql2/promise');

async function check() {
  const prod = dotenv.parse(fs.readFileSync('/opt/fabric/.env'));
  const candidate = dotenv.parse(fs.readFileSync(process.argv[1]));
  const port = Number(candidate.PORT);
  for (const key of ['DB_DATABASE', 'DB_USER', 'COS_BUCKET', 'COS_SECRET_ID', 'COS_SECRET_KEY']) {
    if (!prod[key] || !candidate[key] || candidate[key] === prod[key]) throw Error();
  }
  if (candidate.HOST !== '127.0.0.1' || !/^31\d{2}$/.test(candidate.PORT) ||
      !['127.0.0.1', 'localhost'].includes(candidate.DB_HOST) ||
      !/^fabric_(?:candidate|release_check)_[a-z0-9_]+$/.test(candidate.DB_DATABASE) ||
      candidate.FABRIC_V2_EXPECTED_DATABASE !== candidate.DB_DATABASE ||
      candidate.ASSET_STORAGE_PROVIDER !== 'cos' || candidate.IMAGE_ASSETS_ENABLED !== 'true') throw Error();

  const db = await mysql.createConnection({
    host: candidate.DB_HOST,
    port: Number(candidate.DB_PORT || 3306),
    user: candidate.DB_USER,
    password: candidate.DB_PASSWORD,
    database: candidate.DB_DATABASE,
    connectTimeout: 5000,
  });
  try {
    const [[identity]] = await db.query('SELECT @@server_uuid AS uuid, DATABASE() AS selectedDb');
    if (identity.uuid !== candidate.FABRIC_V2_EXPECTED_UUID || identity.selectedDb !== candidate.DB_DATABASE) throw Error();
    const [rows] = await db.query('SHOW GRANTS');
    const scope = ' ON \x60' + candidate.DB_DATABASE + '\x60.* TO ';
    if (!rows.length || !rows.every(row => {
      const grant = Object.values(row)[0];
      return grant.startsWith('GRANT USAGE ON *.* TO ') ||
        (grant.startsWith('GRANT ') && grant.includes(scope) && !grant.includes('WITH GRANT OPTION'));
    })) throw Error();
  } finally {
    await db.end();
  }
  process.stdout.write(String(port));
}

check().catch(() => { process.exitCode = 1; });
"""


def check(value, message):
    if not value:
        raise RuntimeError(message)


def run(args, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=40)
    check(result.returncode == 0, f'{args[0]} {args[1]} failed')
    return result.stdout


def pm2(*args, cwd=None):
    env = {
        'PATH': os.environ['PATH'],
        'HOME': str(STATE),
        'PM2_HOME': str(STATE / 'pm2'),
        'NODE_ENV': 'production',
    }
    return run(['pm2', *args], cwd=cwd or STATE, env=env)


def processes():
    pm2_home = STATE / 'pm2'
    pid_path = pm2_home / 'pm2.pid'
    if not pid_path.is_file() or not (pm2_home / 'rpc.sock').exists():
        return []
    pid = pid_path.read_text().strip()
    if not pid.isdecimal() or not pathlib.Path('/proc', pid).exists():
        return []
    return json.loads(pm2('jlist'))


def runtime(name, directory):
    return [item for item in processes() if item['name'] == name or item['pm2_env']['pm_cwd'] == str(directory)]


def validate_candidate(directory):
    check(directory.is_dir() and directory.resolve() == directory and not directory.is_mount(), 'Candidate directory is missing or indirect')
    for entry in directory.rglob('*'):
        check(not entry.is_mount(), 'Mount inside candidate is forbidden')
        if entry.is_symlink():
            target = entry.resolve(strict=True)
            check(directory in target.parents, 'Link outside candidate is forbidden')
    for relative in ['.env', 'start-v2.cjs', 'dist/server.cjs']:
        entry = directory / relative
        check(entry.is_file() and not entry.is_symlink() and entry.stat().st_nlink == 1, 'Candidate runtime files must be independent')
    check(directory.stat().st_mode & 0o077 == 0 and (directory / '.env').stat().st_mode & 0o077 == 0, 'Candidate directory and .env must be private')
    uploads = directory / 'uploads'
    check(uploads.is_dir() and not uploads.is_symlink(), 'An independent uploads directory is required')
    for entry in uploads.rglob('*'):
        check(not entry.is_symlink() and (not entry.is_file() or entry.stat().st_nlink == 1), 'Upload files must be independent')
    result = subprocess.run(
        ['node', '-e', ISOLATION_CHECK, str(directory / '.env')],
        cwd=directory, env={'PATH': os.environ['PATH']}, capture_output=True,
        text=True, timeout=20,
    )
    check(result.returncode == 0 and re.fullmatch(r'31\d{2}', result.stdout), 'Candidate isolation check failed (port, MySQL grants, or dedicated COS settings)')
    return int(result.stdout)


def wait_for_health(port):
    for _ in range(30):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=1) as response:
                health = json.load(response)
                if health.get('status') == 'ok' and health.get('mode') == 'v2' and health.get('storage') == 'mysql':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise RuntimeError('Candidate health check failed')



def handle(action, slug):
    name = 'fabric-candidate-' + slug
    directory = ROOT / slug
    current = runtime(name, directory)
    check(all(item['name'] == name and item['pm2_env']['pm_cwd'] == str(directory) for item in current), 'Candidate PM2 identity mismatch')
    if action == 'status':
        if current:
            print(json.dumps({'name': name, 'pid': current[0]['pid'], 'status': current[0]['pm2_env']['status']}))
        else:
            print(json.dumps({'name': name, 'status': 'stopped', 'hasDirectory': directory.is_dir()}))
        return
    if action == 'start':
        check(PRODUCTION.is_dir(), 'Fixed production runtime is unavailable for the isolation check')
        check(not current, 'Candidate is already registered. Stop it first.')
        port = validate_candidate(directory)
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError('Candidate port is already in use') from None
        pm2('start', str(directory / 'start-v2.cjs'), '--name', name, '--cwd', str(directory), '--no-autorestart', cwd=directory)
        try:
            wait_for_health(port)
        except RuntimeError:
            pm2('delete', name)
            raise
        print(json.dumps({'name': name, 'status': 'online', 'port': port}))
        return
    if action == 'stop':
        if current:
            pm2('delete', name)
        print(json.dumps({'name': name, 'status': 'stopped'}))
        return
    check(not current, 'Stop the candidate before cleaning its files')
    if directory.exists() or directory.is_symlink():
        check(directory.is_dir() and directory.resolve() == directory and not directory.is_mount(), 'Unsafe candidate cleanup target')
        check(not any(not entry.is_symlink() and entry.is_mount() for entry in directory.rglob('*')), 'Candidate contains a mount')
        shutil.rmtree(directory)
    print(json.dumps({'name': name, 'status': 'cleaned'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status', 'clean'])
    parser.add_argument('candidate')
    args = parser.parse_args()
    check(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', args.candidate), 'Invalid candidate name')
    os.umask(0o077)
    for location in (ROOT, STATE):
        location.mkdir(mode=0o700, exist_ok=True)
        check(location.resolve() == location and location.stat().st_mode & 0o077 == 0, 'Candidate roots must be private directories')
    with (STATE / 'lifecycle.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        handle(args.action, args.candidate)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error) if type(error) is RuntimeError else 'Candidate operation failed', file=sys.stderr)
        sys.exit(1)
