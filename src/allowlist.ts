/**
 * Read-only command policy — a strict allowlist.
 *
 * Unlike a denylist (which is inherently leaky — novel destructive commands slip
 * through), this module permits only commands that are known to be read-only and
 * rejects everything else. It is the authoritative safety boundary for every
 * command the package spawns, independent of which agent or LLM is driving.
 *
 * The check is shell-aware: it splits a command line into segments on the control
 * operators `|`, `&&`, `||`, `;` (respecting single/double quotes), then validates
 * the leading executable of each segment plus its sub-command/arguments.
 */

/** Plain read-only executables — no sub-command restriction needed. */
const READONLY_BINARIES = new Set<string>([
  // shell & text utilities
  'echo', 'printf', 'true', 'false', 'test', 'cat', 'head', 'tail', 'grep', 'egrep',
  'fgrep', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc', 'tr', 'xargs', 'tee',
  'ls', 'find', 'which', 'command', 'type', 'basename', 'dirname', 'realpath',
  'readlink', 'stat', 'file', 'printenv', 'date', 'hostname', 'uname',
  'whoami', 'id', 'pwd', 'expr', 'seq', 'tac', 'rev', 'column', 'paste',
  // network & process inspection (read-only)
  'ss', 'netstat', 'lsof', 'ps', 'ip', 'ifconfig', 'arp', 'dig', 'nslookup', 'host',
  // database clients (read-only usage is enforced separately for risky verbs)
  'psql', 'mysql', 'mysqladmin', 'mongosh', 'redis-cli', 'sqlite3', 'pg_lsclusters',
  'clickhouse-client',
  // macOS
  'mdfind',
]);

/** `tee` is read-only only when writing to the bit bucket; otherwise it writes files. */
const CONDITIONAL_BINARIES = new Set<string>(['tee']);

/** Package managers: list/query only — reject install/remove/upgrade-style verbs and flags. */
const PKG_MANAGERS = new Set<string>(['dpkg', 'rpm', 'snap', 'flatpak', 'brew', 'winget', 'choco', 'scoop', 'apt-cache']);
const MUTATING_PKG = /^(install|uninstall|reinstall|remove|purge|erase|upgrade|update|add|delete|pin|enable|disable|-i|--install|-r|--remove|-P|--purge|-e|--erase|-U|--upgrade|-F|--freshen)$/i;

/** Executables that run another command supplied as an argument — must be validated recursively. */
const COMMAND_RUNNERS = new Set<string>(['xargs', 'env', 'nice', 'nohup', 'timeout', 'time', 'stdbuf', 'watch', 'sudo']);

/** Mutating PowerShell cmdlets and Windows commands — rejected in PowerShell mode. */
const DANGEROUS_PS = /\b(Remove-Item|Remove-ItemProperty|Move-Item|Copy-Item|Rename-Item|New-Item|New-Service|Set-Content|Add-Content|Clear-Content|Out-File|Set-ItemProperty|Set-Service|Stop-Process|Stop-Service|Start-Service|Restart-Service|Stop-Computer|Restart-Computer|Format-Volume|Clear-Disk|Remove-\w+|Uninstall-\w+|Install-\w+|Set-\w+|New-\w+|Start-\w+|Stop-\w+|Restart-\w+|Invoke-Expression|iex|Invoke-WebRequest|Invoke-RestMethod|Invoke-Command|Start-Process|Register-\w+|Unregister-\w+|Disable-\w+|Enable-\w+|Reset-\w+|del|rmdir|rd)\b/i;

/** Coarse Unix destructive denylist — defense-in-depth backstop. */
const DANGEROUS_POSIX = /\b(rm|rmdir|mv|dd|mkfs|chmod|chown|chgrp|kill|killall|pkill|reboot|shutdown|poweroff|halt|truncate|shred|fdisk|parted)\b/i;

/**
 * Multi-verb tools: the first non-flag token after the binary (and, for some, the
 * whole token list) must satisfy a read-only predicate.
 */
const SUBCOMMAND_RULES: Record<string, (tokens: string[]) => boolean> = {
  kubectl: (t) => allowFirstVerb(t, ['get', 'describe', 'top', 'logs', 'explain', 'config', 'version', 'cluster-info', 'api-resources', 'api-versions', 'auth']),
  docker: (t) => allowFirstVerb(t, ['ps', 'images', 'inspect', 'version', 'info', 'logs', 'stats', 'top', 'port', 'history', 'diff', 'system', 'context', 'volume', 'network', 'image', 'container']) && !hasMutatingDockerVerb(t),
  podman: (t) => SUBCOMMAND_RULES['docker']!(t),
  helm: (t) => allowFirstVerb(t, ['list', 'ls', 'status', 'get', 'show', 'history', 'version', 'repo', 'search', 'env']),
  systemctl: (t) => allowFirstVerb(t, ['status', 'show', 'list-units', 'list-unit-files', 'list-sockets', 'list-timers', 'list-dependencies', 'is-active', 'is-enabled', 'is-failed', 'cat', 'get-default', 'show-environment']),
  service: (t) => t.some((x) => /^status$/i.test(x)),
  // cloud CLIs: read-only actions only — must contain a read verb, never a mutating one
  aws: (t) => containsAwsReadAction(t) && !hasMutatingCloudVerb(t),
  gcloud: (t) => (hasToken(t, ['list', 'describe']) || isInfoOnly(t)) && !hasMutatingCloudVerb(t),
  az: (t) => (hasToken(t, ['list', 'show']) || isInfoOnly(t)) && !hasMutatingCloudVerb(t),
  // version control (read-only verbs only)
  git: (t) => allowFirstVerb(t, ['status', 'log', 'show', 'diff', 'branch', 'remote', 'config', 'rev-parse', 'ls-files', 'ls-remote', 'describe', 'tag', 'shortlog', 'cat-file', 'symbolic-ref']),
  gh: (t) => allowFirstVerb(t, ['repo', 'pr', 'issue', 'release', 'api', 'auth', 'status']) && hasToken(t, ['list', 'view', 'status', 'get']),
};

/** curl/wget: GET-only, no file writes, no request methods or bodies. */
const FETCH_RULES: Record<string, (tokens: string[]) => boolean> = {
  curl: (t) => !t.some((x) => /^-X$/i.test(x) || /^--request$/i.test(x) || /^-[dF]$/.test(x) || /^--data/i.test(x) || /^--form$/i.test(x) || /^-[oO]$/.test(x) || /^--output$/i.test(x) || /^--upload-file$/i.test(x)),
  wget: (t) => !t.some((x) => /^-O$/.test(x) || /^--output-document/i.test(x) || /^--post-data/i.test(x) || /^--method/i.test(x) || /^-i$/.test(x)),
};

/** Read-only PowerShell verbs (cmdlets are `Verb-Noun`). */
const READONLY_PS_VERBS = new Set<string>([
  'get', 'select', 'where', 'measure', 'sort', 'format', 'out', 'convertto',
  'convertfrom', 'compare', 'test', 'resolve', 'split', 'join', 'group', 'foreach',
  'write', 'read', 'show', 'find', 'search', 'tee',
]);

/** Bare PowerShell helpers / aliases that are read-only. */
const READONLY_PS_BARE = new Set<string>(['where', 'select', 'sort', 'foreach', 'ft', 'fl', 'gci', 'gc', 'gm', 'gps', 'gsv', 'echo', 'write-host', 'write-output']);

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

export type ShellKind = 'posix' | 'powershell';

// ── Helpers ──────────────────────────────────────────────────────────────────

function allowFirstVerb(tokens: string[], verbs: string[]): boolean {
  const verb = tokens.find((t) => !t.startsWith('-'));
  return verb !== undefined && verbs.includes(verb.toLowerCase());
}

function hasToken(tokens: string[], any: string[]): boolean {
  const lower = tokens.map((t) => t.toLowerCase());
  return any.some((a) => lower.includes(a));
}

function isInfoOnly(tokens: string[]): boolean {
  // e.g. `gcloud config list ...`, `az account show`
  return hasToken(tokens, ['config', 'account', 'version', 'info']);
}

const MUTATING_CLOUD = /^(create|delete|update|put|set|add|remove|deploy|run|start|stop|restart|reboot|terminate|modify|attach|detach|associate|disassociate|enable|disable|invoke|exec|apply|destroy|scale|patch|register|deregister|import|copy|move|rename|reset|rotate|revoke|grant)([-_].*)?$/i;

function hasMutatingCloudVerb(tokens: string[]): boolean {
  return tokens.some((t) => !t.startsWith('-') && MUTATING_CLOUD.test(t));
}

function containsAwsReadAction(tokens: string[]): boolean {
  // aws <service> <action> — action must be read-only
  return tokens.some((t) => /^(describe|list|get|lookup|search|scan|view|ls)[-_a-z0-9]*$/i.test(t) || t.toLowerCase() === 'ls');
}

function hasMutatingDockerVerb(tokens: string[]): boolean {
  return tokens.some((t) => /^(run|rm|rmi|exec|build|push|pull|start|stop|kill|create|commit|cp|save|load|tag|login|logout|prune|kill|restart|pause|unpause|rename|update|export|import)$/i.test(t));
}

/** Split a command line on shell control operators, honoring single/double quotes. */
export function splitSegments(cmd: string): string[] {
  const segments: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    const next = cmd[i + 1];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    // command substitution is rejected wholesale elsewhere; treat `$(` as a break too
    if ((c === '|' && next === '|') || (c === '&' && next === '&')) { segments.push(buf); buf = ''; i++; continue; }
    if (c === '|' || c === ';' || c === '\n') { segments.push(buf); buf = ''; continue; }
    buf += c;
  }
  segments.push(buf);
  return segments.map((s) => s.trim()).filter(Boolean);
}

/** Tokenize one segment into words, honoring quotes and stripping them. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  const push = () => { if (started) { tokens.push(buf); buf = ''; started = false; } };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (quote) { if (c === quote) quote = null; else buf += c; started = true; continue; }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (c === ' ' || c === '\t') { push(); continue; }
    buf += c; started = true;
  }
  push();
  return tokens;
}

function baseName(executable: string): string {
  const noPath = executable.split(/[\\/]/).pop() ?? executable;
  return noPath.toLowerCase();
}

/** `find` is read-only unless it is asked to execute or delete. */
function findIsReadOnly(rest: string[]): boolean {
  return !rest.some((t) => /^-(exec|execdir|ok|okdir|delete|fprintf|fprint|fls)$/i.test(t));
}

/** Guard `awk`/`sed` programs against shelling out. */
function awkSedIsReadOnly(exe: string, rest: string[]): boolean {
  const program = rest.join(' ');
  if (exe === 'awk') return !/\bsystem\s*\(/.test(program) && !/\|\s*["']/.test(program) && !/print\s*>/.test(program);
  // sed: reject the `e` (execute) command and the s///e flag and `w` (write file)
  return !/(^|;|\{|\s)e\b/.test(program) && !/s[^\s]*\/[a-z]*e[a-z]*\b/i.test(program) && !/\bw\s+\S/.test(program);
}

function isWriteRedirect(segment: string): boolean {
  // Allow only redirects to the bit bucket / stderr merge: 2>/dev/null, >/dev/null, 2>&1, *> $null, Out-Null
  // Reject any other `>` or `>>` (file writes).
  const stripped = segment
    .replace(/\d?>>?\s*\/dev\/null/g, '')
    .replace(/\d?>\s*&\s*\d/g, '')
    .replace(/\d?>\s*\$null/gi, '');
  return /(^|[^0-9&])>>?/.test(stripped);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Decide whether a command line is read-only and therefore safe to execute.
 * Returns `{ allowed: false, reason }` for anything not explicitly permitted.
 */
export function checkReadOnly(command: string, opts: { shell?: ShellKind } = {}): PolicyResult {
  const cmd = command.trim();
  if (!cmd) return { allowed: false, reason: 'empty command' };

  // PowerShell uses `$(...)`, `;`-in-blocks and `{}` legitimately, so a POSIX parser
  // would mis-fire. In PowerShell mode we reject file writes and mutating cmdlets instead.
  if (opts.shell === 'powershell') {
    if (isWriteRedirect(cmd)) return { allowed: false, reason: 'file-writing redirect is not allowed' };
    if (DANGEROUS_PS.test(cmd)) return { allowed: false, reason: 'mutating PowerShell cmdlet is not allowed' };
    if (DANGEROUS_POSIX.test(cmd)) return { allowed: false, reason: 'destructive command is not allowed' };
    return { allowed: true };
  }

  // Reject command substitution and backticks — they hide arbitrary execution.
  if (/\$\(|`/.test(cmd)) return { allowed: false, reason: 'command substitution is not allowed' };

  // Reject file-writing redirects (anything other than /dev/null or stderr merge).
  if (isWriteRedirect(cmd)) return { allowed: false, reason: 'file-writing redirect is not allowed' };

  for (const segment of splitSegments(cmd)) {
    const r = checkSegment(segment);
    if (!r.allowed) return r;
  }

  return { allowed: true };
}

/** Validate a single pipeline segment's leading executable and its arguments. */
function checkSegment(segment: string): PolicyResult {
  // Drop leading inline env assignments (`FOO=bar cmd`) and shell grouping tokens (`{ } ( )`).
  let tokens = tokenize(segment)
    .filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))
    .filter((t) => t !== '{' && t !== '}' && t !== '(' && t !== ')');
  if (tokens.length === 0) return { allowed: true };

  let exe = baseName(tokens[0]!);
  let rest = tokens.slice(1);

  // Command runners (xargs, timeout, nice, env, ...): unwrap to the inner command and validate it.
  while (COMMAND_RUNNERS.has(exe)) {
    // skip the runner's own flags and their values, plus xargs replace-string (-I {})
    const inner: string[] = [];
    let i = 0;
    for (; i < rest.length; i++) {
      const t = rest[i]!;
      if (t.startsWith('-')) { if (/^-(I|n|L|P|d|s|E|u|g)$/.test(t)) i++; continue; }
      inner.push(...rest.slice(i));
      break;
    }
    if (inner.length === 0) return { allowed: true }; // runner with no inner command (e.g. `env`, `xargs echo`-less)
    exe = baseName(inner[0]!);
    rest = inner.slice(1);
  }

  if (exe === 'find') {
    if (!findIsReadOnly(rest)) return { allowed: false, reason: 'find: -exec/-delete is not allowed' };
    return { allowed: true };
  }
  if (exe === 'awk' || exe === 'sed') {
    if (!awkSedIsReadOnly(exe, rest)) return { allowed: false, reason: `${exe}: program may not shell out or write files` };
    return { allowed: true };
  }
  if (PKG_MANAGERS.has(exe)) {
    if (rest.some((t) => MUTATING_PKG.test(t))) return { allowed: false, reason: `${exe}: only list/query sub-commands are allowed` };
    return { allowed: true };
  }
  if (FETCH_RULES[exe]) {
    if (!FETCH_RULES[exe]!(rest)) return { allowed: false, reason: `${exe}: only read-only GET requests are allowed` };
    return { allowed: true };
  }
  if (SUBCOMMAND_RULES[exe]) {
    if (!SUBCOMMAND_RULES[exe]!(rest)) return { allowed: false, reason: `${exe}: sub-command is not read-only` };
    return { allowed: true };
  }
  if (CONDITIONAL_BINARIES.has(exe)) {
    if (rest.some((t) => !t.startsWith('-') && t !== '/dev/null')) return { allowed: false, reason: 'tee may only write to /dev/null' };
    return { allowed: true };
  }
  if (READONLY_BINARIES.has(exe)) return { allowed: true };
  if (READONLY_PS_BARE.has(exe)) return { allowed: true };

  // PowerShell cmdlet fallback: Verb-Noun where the verb must be read-only.
  if (exe.includes('-') && /^[a-z]+-[a-z]/.test(exe)) {
    const verb = exe.split('-')[0]!;
    if (READONLY_PS_VERBS.has(verb)) return { allowed: true };
    return { allowed: false, reason: `PowerShell cmdlet not read-only: ${exe}` };
  }

  return { allowed: false, reason: `command not on read-only allowlist: ${exe}` };
}

/** Convenience boolean form. */
export function isReadOnlyCommand(command: string): boolean {
  return checkReadOnly(command).allowed;
}

/** Throwing form for guard sites that prefer exceptions. */
export function assertReadOnly(command: string): void {
  const r = checkReadOnly(command);
  if (!r.allowed) throw new Error(`Blocked by read-only allowlist: ${r.reason}`);
}
