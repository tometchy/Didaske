import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const app = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.platform === 'win32' ? 'python' : 'python3', [
  'data/build/snapshot.py', '--repo', '.', '--output', 'build/content.sqlite3'
], repo);
if (process.env.npm_execpath) {
  run(process.execPath, [process.env.npm_execpath, 'run', 'build:native'], app);
} else if (process.platform === 'win32') {
  run('cmd.exe', ['/d', '/c', 'npm run build:native'], app);
} else {
  run('npm', ['run', 'build:native'], app);
}
