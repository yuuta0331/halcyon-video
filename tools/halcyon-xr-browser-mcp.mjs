import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = [
  '-y',
  'chrome-devtools-mcp@latest',
  '--isolated',
  `--user-data-dir=${path.join(root, '.cache', 'halcyon-xr-chrome')}`,
  '--no-usage-statistics',
];

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: root,
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 1));
