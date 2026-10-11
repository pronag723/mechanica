// `pnpm oracle`: runs tools/oracle/oracle.py with the first working Python 3 among `python`,
// `python3` and the Windows launcher `py -3`. A candidate counts only if `--version` reports
// Python 3, which skips the Microsoft Store stubs Windows installs as python.exe / python3.exe.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./oracle.py', import.meta.url));
const candidates = [['python'], ['python3'], ['py', '-3']];
// A fixed hash seed rules out set-ordering differences between runs.
const env = { ...process.env, PYTHONHASHSEED: '0', PYTHONIOENCODING: 'utf-8' };

function isPython3([command, ...args]) {
  const probe = spawnSync(command, [...args, '--version'], { encoding: 'utf8', env });
  return probe.status === 0 && /^Python 3\./.test(`${probe.stdout}${probe.stderr}`.trim());
}

const python = candidates.find(isPython3);
if (!python) {
  console.error('oracle: no Python 3 found (tried python, python3, py -3). Install Python 3.');
  process.exit(1);
}

const [command, ...args] = python;
const run = spawnSync(command, [...args, script, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
process.exit(run.status ?? 1);
