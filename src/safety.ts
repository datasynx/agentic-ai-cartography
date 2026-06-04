// PreToolUse Safety Hook — enforces the read-only allowlist on all Bash calls.
//
// This is the Claude-Code-specific adapter. The authoritative policy lives in
// ./allowlist.ts and is shared with the MCP server, so safety is identical no
// matter which agent or model drives discovery.

import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { checkReadOnly } from './allowlist.js';

export type { HookCallback };

export const safetyHook: HookCallback = async (input, _toolUseID, _options) => {
  // Only intercept PreToolUse events (other hook events don't have tool_name)
  if (!('tool_name' in input)) return {};
  if ((input as { tool_name: string }).tool_name !== 'Bash') return {};

  const cmd = (((input as { tool_input: { command?: string } }).tool_input)?.command ?? '').trim();

  // An empty command runs nothing — allow it (matches Claude Code's no-op behavior).
  if (!cmd) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  }

  const decision = checkReadOnly(cmd);
  if (!decision.allowed) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `BLOCKED: ${decision.reason} — read-only allowlist policy`,
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  };
};
