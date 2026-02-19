import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function isOAuthLoggedIn(): boolean {
  // Claude CLI speichert OAuth-Tokens in ~/.claude/.credentials.json
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const credFile = join(home, '.claude', '.credentials.json');
  if (!existsSync(credFile)) return false;
  try {
    const creds = JSON.parse(readFileSync(credFile, 'utf8')) as Record<string, unknown>;
    const oauth = creds['claudeAiOauth'] as Record<string, unknown> | undefined;
    return typeof oauth?.['accessToken'] === 'string' && oauth['accessToken'].length > 0;
  } catch {
    return false;
  }
}

export function checkPrerequisites(): void {
  // Claude CLI vorhanden?
  try {
    execSync('claude --version', { stdio: 'pipe' });
  } catch {
    process.stderr.write(
      '\n❌ Claude CLI nicht gefunden.\n' +
      '   Datasynx Cartography braucht die Claude CLI als Runtime-Dependency.\n\n' +
      '   Installieren:\n' +
      '     npm install -g @anthropic-ai/claude-code\n' +
      '     # oder\n' +
      '     curl -fsSL https://claude.ai/install.sh | bash\n\n' +
      '   Danach: claude login\n\n'
    );
    process.exitCode = 1;
    throw new Error('Claude CLI not found');
  }

  // Auth prüfen: API Key ODER OAuth-Login (claude.ai Subscription)
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOAuth = isOAuthLoggedIn();

  if (!hasApiKey && !hasOAuth) {
    process.stderr.write(
      '⚠ Keine Authentifizierung gefunden. Bitte eine der folgenden Optionen:\n\n' +
      '  Option A — claude.ai Subscription (empfohlen):\n' +
      '    claude login\n\n' +
      '  Option B — API Key:\n' +
      '    export ANTHROPIC_API_KEY=sk-ant-...\n\n'
    );
  } else if (hasOAuth && !hasApiKey) {
    process.stderr.write('✓ Eingeloggt via claude login (Subscription)\n');
  }
}
