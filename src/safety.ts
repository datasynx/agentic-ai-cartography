// PreToolUse Safety Hook — enforces read-only policy on all Bash calls

import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

// Word-boundary matched dangerous commands (Unix + Windows/PowerShell)
const BLOCKED_CMDS =
  /\b(rm|mv|cp|dd|mkfs|chmod|chown|chgrp|kill|killall|pkill|reboot|shutdown|poweroff|halt|systemctl\s+(start|stop|restart|enable|disable)|service\s+(start|stop|restart)|docker\s+(rm|rmi|stop|kill|exec|run|build|push)|kubectl\s+(delete|apply|edit|exec|run|create|patch)|apt|yum|dnf|pacman|pip\s+install|npm\s+(install|uninstall)|curl\s+.*-X\s*(POST|PUT|DELETE|PATCH)|wget\s+-O|tee\s|Remove-Item|Move-Item|Copy-Item|Stop-Process|Stop-Service|Restart-Service|Start-Service|Set-Service|Invoke-WebRequest\s+.*-Method\s+(POST|PUT|DELETE|PATCH)|del\s|rmdir\s|Format-Volume|Clear-Disk|Stop-Computer|Restart-Computer|Uninstall-Package|Install-Package|Install-Module)\b/i;
// Redirect operators (no word boundary needed) — both Unix and PowerShell
const BLOCKED_REDIRECTS = />>|>[^>]|Out-File|Set-Content|Add-Content/;

export type { HookCallback };

export const safetyHook: HookCallback = async (input, _toolUseID, _options) => {
  // Only intercept PreToolUse events (other hook events don't have tool_name)
  if (!('tool_name' in input)) return {};
  if ((input as { tool_name: string }).tool_name !== 'Bash') return {};

  const cmd = ((input as { tool_input: { command?: string } }).tool_input)?.command ?? '';

  if (BLOCKED_CMDS.test(cmd) || BLOCKED_REDIRECTS.test(cmd)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `BLOCKED: "${cmd}" — read-only policy`,
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
