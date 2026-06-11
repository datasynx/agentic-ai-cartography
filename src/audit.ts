// PostToolUse Audit Hook — records every executed tool call into activity_events.
//
// Governance/audit trail: for each tool the agent runs during discovery we persist
// { tool, command, result bytes, timestamp } so an operator can review what ran.
// Audit failures must never break discovery, so the write is best-effort.

import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { CartographyDB } from './db.js';
import { logDebug } from './logger.js';

/** Build a PostToolUse hook bound to a session that logs executed tools to the catalog. */
export function createAuditHook(db: CartographyDB, sessionId: string): HookCallback {
  return async (input) => {
    try {
      if (!('tool_name' in input)) return {};
      const i = input as { tool_name: string; tool_input?: { command?: string }; tool_response?: unknown };
      const command = i.tool_input?.command ?? JSON.stringify(i.tool_input ?? {}).slice(0, 2000);
      const response = typeof i.tool_response === 'string' ? i.tool_response : JSON.stringify(i.tool_response ?? '');
      db.insertEvent(sessionId, {
        eventType: 'tool_executed',
        process: i.tool_name,
        pid: process.pid,
        command,
        resultBytes: Buffer.byteLength(response),
      });
    } catch (err) {
      logDebug(`audit hook failed to record event: ${String(err)}`);
    }
    return {};
  };
}
