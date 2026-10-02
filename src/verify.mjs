import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProject, packageRoot } from './core.mjs';

export async function runCheck(check, root) {
  const command = check.command.map(arg => arg === '{biveNodeReporter}' ? path.join(packageRoot, 'src/node-reporter.mjs') : arg);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  return new Promise(resolve => {
    const env = { ...process.env, ...check.env };
    // Each command is an independent run even when BIVE itself is called from node --test.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(command[0], command.slice(1), { cwd: root, shell: false, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', truncated = false, settled = false, timedOut = false;
    const tests = [], partial = [];
    const limit = 1024 * 1024;
    const stop = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; stop(); }, check.timeoutMs ?? 60000);
    child.stdout.on('data', data => {
      if (stdout.length < limit) stdout += data.toString(); else truncated = true;
      if (check.runner === 'node-test') {
        partial.push(data.toString());
        const lines = partial.join('').split('\n');
        partial.length = 0;
        partial.push(lines.pop());
        for (const line of lines) { try { const item = JSON.parse(line); if (item.type?.startsWith('test:')) tests.push(item); } catch {} }
      }
    });
    child.stderr.on('data', data => { if (stderr.length < limit) stderr += data.toString(); else truncated = true; });
    function finish(exitCode, error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const missing = (check.testNames ?? []).filter(name => !tests.some(t => t.name === name));
      const skipped = (check.testNames ?? []).filter(name => tests.some(t => t.name === name && t.skip));
      const failed = tests.filter(t => t.type === 'test:fail');
      const passed = exitCode === 0 && !error && !timedOut && !missing.length && !skipped.length && !failed.length;
      resolve({ id: check.id, status: passed ? 'passing' : 'failing', startedAt, durationMs: Date.now() - started, command, exitCode, timedOut, error: error?.message ?? null, missing, skipped, tests, stdout, stderr, truncated, rules: check.rules ?? [], examples: check.examples ?? [] });
    }
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
  });
}

export async function verifyCapability(project, cap, onResult = () => {}) {
  const results = [];
  // Commands are deliberately sequential. Test fixtures can share resources.
  for (const check of cap.checks) {
    const result = await runCheck(check, project.root);
    results.push(result); onResult(result);
  }
  const current = (await loadProject(project.root)).capabilities.find(c => c.id === cap.id);
  const report = { version: 1, capability: cap.id, digest: cap.digest, finishedAt: new Date().toISOString(), changedDuringRun: current.digest !== cap.digest, results };
  const directory = path.join(project.root, '.bive/evidence');
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${cap.id}.json`), temp = destination + '.tmp';
  await writeFile(temp, JSON.stringify(report, null, 2) + '\n');
  await rename(temp, destination);
  return report;
}
