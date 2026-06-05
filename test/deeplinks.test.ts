import { describe, it, expect } from 'vitest';
import { cursorDeeplink, vscodeDeeplink, codeAddMcpCommand } from '../src/installer/deeplinks.js';
import { defaultServerEntry } from '../src/installer/index.js';

const entry = defaultServerEntry();

describe('cursorDeeplink', () => {
  it('emits the cursor scheme with a base64-encoded server config', () => {
    const link = cursorDeeplink('cartography', entry);
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')).toBe(true);
    const url = new URL(link);
    expect(url.searchParams.get('name')).toBe('cartography');
    const decoded = JSON.parse(Buffer.from(url.searchParams.get('config')!, 'base64').toString('utf8'));
    expect(decoded.command).toBe('npx');
    expect(decoded.args).toContain('cartography-mcp');
  });
});

describe('vscodeDeeplink', () => {
  it('emits the vscode scheme with URL-encoded (not base64) JSON including the name', () => {
    const link = vscodeDeeplink('cartography', entry);
    expect(link.startsWith('vscode://mcp/install?')).toBe(true);
    const encoded = link.slice('vscode://mcp/install?'.length);
    // URL-encoded JSON round-trips via decodeURIComponent
    const obj = JSON.parse(decodeURIComponent(encoded));
    expect(obj.name).toBe('cartography');
    expect(obj.command).toBe('npx');
  });
  it('uses insiders scheme when requested', () => {
    expect(vscodeDeeplink('cartography', entry, { insiders: true }).startsWith('vscode-insiders://mcp/install?')).toBe(true);
  });
});

describe('codeAddMcpCommand', () => {
  it('produces a `code --add-mcp` one-liner with the name embedded', () => {
    const cmd = codeAddMcpCommand('cartography', entry);
    expect(cmd.startsWith('code --add-mcp ')).toBe(true);
    const json = JSON.parse(cmd.slice('code --add-mcp '.length).replace(/^'|'$/g, ''));
    expect(json.name).toBe('cartography');
  });
});
