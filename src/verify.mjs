import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { loadProject, packageRoot } from './core.mjs';
import { atomicWrite } from './paths.mjs';

export async function runCheck(check, root) {
  const command = check.command.map((arg) =>
    arg === '{mhprotoNodeReporter}' ? path.join(packageRoot, 'src/node-reporter.mjs') : arg,
  );
  const startedAt = new Date().toISOString();
  const started = Date.now();
  return new Promise((resolve) => {
    const env = { ...process.env, ...check.env };
    // Each command is an independent run even when MHProto itself is called from node --test.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(command[0], command.slice(1), {
      cwd: root,
      shell: false,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '',
      stderr = '',
      truncated = false,
      settled = false,
      timedOut = false;
    const tests = [];
    const decoder = new StringDecoder('utf8');
    let pending = '',
      eventBytes = 0,
      malformed = false;
    const limit = 1024 * 1024;
    const stop = () => {
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, check.timeoutMs ?? 60000);
    child.stdout.on('data', (data) => {
      const text = decoder.write(data);
      if (stdout.length + text.length > limit) truncated = true;
      stdout += text.slice(0, Math.max(0, limit - stdout.length));
      if (check.runner === 'node-test') {
        eventBytes += data.length;
        if (eventBytes > limit) {
          malformed = true;
          stop();
          return;
        }
        const lines = (pending + text).split('\n');
        pending = lines.pop();
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (!['test:pass', 'test:fail'].includes(item.type) || typeof item.name !== 'string')
              malformed = true;
            else tests.push(item);
          } catch {
            if (line.trim()) malformed = true;
          }
        }
      }
    });
    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (stderr.length + text.length > limit) truncated = true;
      stderr += text.slice(0, Math.max(0, limit - stderr.length));
    });
    function finish(exitCode, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const missing = (check.testNames ?? []).filter(
        (name) =>
          !tests.some((t) => t.name === name && ['test:pass', 'test:fail'].includes(t.type)),
      );
      const skipped = (check.testNames ?? []).filter((name) =>
        tests.some((t) => t.name === name && t.skip),
      );
      const todo = (check.testNames ?? []).filter((name) =>
        tests.some((t) => t.name === name && t.todo),
      );
      const failed = tests.filter((t) => t.type === 'test:fail');
      if (pending.trim()) malformed = true;
      const passed =
        exitCode === 0 &&
        !error &&
        !timedOut &&
        !malformed &&
        !missing.length &&
        !skipped.length &&
        !todo.length &&
        !failed.length;
      resolve({
        id: check.id,
        status: passed ? 'passing' : 'failing',
        startedAt,
        durationMs: Date.now() - started,
        command,
        exitCode,
        timedOut,
        error:
          error?.message ?? (malformed ? 'Invalid or oversized node-test reporter output' : null),
        missing,
        skipped,
        todo,
        tests,
        stdout,
        stderr,
        truncated,
        rules: check.rules ?? [],
        examples: check.examples ?? [],
      });
    }
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });
}

export async function verifyCapability(project, cap, onResult = () => {}) {
  const results = [];
  // Commands are deliberately sequential. Test fixtures can share resources.
  for (const check of cap.checks) {
    const result = await runCheck(check, project.root);
    results.push(result);
    onResult(result);
  }
  const current = (await loadProject(project.root)).capabilities.find((c) => c.id === cap.id);
  const report = {
    version: 1,
    capability: cap.id,
    digest: cap.digest,
    finishedAt: new Date().toISOString(),
    changedDuringRun: current?.digest !== cap.digest,
    results,
  };
  await atomicWrite(
    project.root,
    `.mhproto/evidence/${cap.id}.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  return report;
}
