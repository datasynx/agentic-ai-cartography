import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function isOAuthLoggedIn(): boolean {
  // Claude CLI stores OAuth tokens in ~/.claude/.credentials.json
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
  // Claude CLI present?
  try {
    execSync('claude --version', { stdio: 'pipe' });
  } catch {
    process.stderr.write(
      '\n❌ Claude CLI not found.\n' +
      '   Datasynx Cartography requires the Claude CLI as a runtime dependency.\n\n' +
      '   Install:\n' +
      '     npm install -g @anthropic-ai/claude-code\n' +
      '     # or\n' +
      '     curl -fsSL https://claude.ai/install.sh | bash\n\n' +
      '   Then: claude login\n\n'
    );
    process.exitCode = 1;
    throw new Error('Claude CLI not found');
  }

  // Check auth: API Key OR OAuth login (claude.ai Subscription)
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOAuth = isOAuthLoggedIn();

  if (!hasApiKey && !hasOAuth) {
    process.stderr.write(
      '⚠ No authentication found. Please choose one of the following options:\n\n' +
      '  Option A — claude.ai Subscription (recommended):\n' +
      '    claude login\n\n' +
      '  Option B — API Key:\n' +
      '    export ANTHROPIC_API_KEY=sk-ant-...\n\n'
    );
  } else if (hasOAuth && !hasApiKey) {
    process.stderr.write('✓ Logged in via claude login (Subscription)\n');
  }
}
