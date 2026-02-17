import { execSync } from 'node:child_process';
import { MIN_POLL_INTERVAL_MS } from './types.js';

export function checkPrerequisites(): void {
  // Claude CLI vorhanden?
  try {
    execSync('claude --version', { stdio: 'pipe' });
  } catch {
    process.stderr.write(
      '\n❌ Claude CLI nicht gefunden.\n' +
      '   Cartograph braucht die Claude CLI als Runtime-Dependency.\n\n' +
      '   Installieren:\n' +
      '     npm install -g @anthropic-ai/claude-code\n' +
      '     # oder\n' +
      '     curl -fsSL https://claude.ai/install.sh | bash\n\n' +
      '   Danach: claude login\n\n'
    );
    process.exitCode = 1;
    throw new Error('Claude CLI not found');
  }

  // API Key vorhanden?
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      '⚠ ANTHROPIC_API_KEY nicht gesetzt.\n' +
      '  Falls du nicht via "claude login" authentifiziert bist,\n' +
      '  setze: export ANTHROPIC_API_KEY=sk-ant-...\n\n'
    );
  }
}

export function checkPollInterval(intervalMs: number): number {
  if (intervalMs < MIN_POLL_INTERVAL_MS) {
    process.stderr.write(
      `⚠ Minimum Shadow-Intervall: ${MIN_POLL_INTERVAL_MS / 1000} Sekunden (Agent SDK Overhead)\n`
    );
    return MIN_POLL_INTERVAL_MS;
  }
  return intervalMs;
}
