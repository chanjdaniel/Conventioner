import { execFileSync } from 'node:child_process';
import { backendContainer } from './containerNames';

/**
 * Run one of `back-end/`'s scripts inside the back-end container, as an operator would run it, and
 * return what it printed. A script that exits non-zero throws, with its output.
 */
export function runBackendScript(script: string, ...args: string[]): string {
  return execFileSync('docker', ['exec', backendContainer(), 'python', `/app/${script}`, ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
}
