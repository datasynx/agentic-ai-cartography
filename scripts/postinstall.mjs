import { execSync } from 'child_process';

try {
  execSync('claude --version', { stdio: 'pipe' });
} catch {
  console.warn('\n\u26A0 datasynx-cartography requires Claude CLI: npm i -g @anthropic-ai/claude-code\n');
}
