import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { CartographyDB } from './db.js';
import { IPCServer, cleanStaleSocket } from './ipc.js';
import { NotificationService } from './notify.js';
import { runShadowCycle } from './agent.js';
import type { CartographyConfig, ShadowStatus } from './types.js';

// ── Snapshot ─────────────────────────────────────────────────────────────────

export function takeSnapshot(config: CartographyConfig): string {
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).toString();
    } catch {
      return `(${cmd}: not available)`;
    }
  };

  const ss = run('ss -tnp 2>/dev/null || ss -tn 2>/dev/null || echo "ss not available"');
  const ps = run('ps aux --sort=-start_time 2>/dev/null | head -50');

  let win = '';
  if (config.trackWindowFocus) {
    try {
      win = execSync('xdotool getactivewindow getwindowname 2>/dev/null', {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 2000,
      }).toString().trim();
    } catch {
      win = '';
    }
  }

  return `=== TCP ===\n${ss}\n=== PS ===\n${ps}\n=== Window ===\n${win}`;
}

// ── ShadowDaemon ─────────────────────────────────────────────────────────────

export class ShadowDaemon {
  private running = false;
  private prevSnapshot = '';
  private cyclesRun = 0;
  private cyclesSkipped = 0;

  constructor(
    private config: CartographyConfig,
    private db: CartographyDB,
    private ipc: IPCServer,
    private notify: NotificationService,
  ) {}

  async run(): Promise<void> {
    this.running = true;
    const sessionId = this.db.createSession('shadow', this.config);

    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());

    while (this.running) {
      const snapshot = takeSnapshot(this.config);

      if (snapshot !== this.prevSnapshot) {
        try {
          await runShadowCycle(
            this.config,
            this.db,
            sessionId,
            this.prevSnapshot,
            snapshot,
            (msg) => {
              if (this.ipc.hasClients()) {
                this.ipc.broadcast({ type: 'agent-output', text: JSON.stringify(msg) });
              }
            },
          );
          this.cyclesRun++;
        } catch (err) {
          process.stderr.write(`⚠ Cycle error: ${err}\n`);
        }
        this.prevSnapshot = snapshot;
      } else {
        this.cyclesSkipped++;
      }

      // Broadcast status
      const status = this.getStatus(sessionId);
      this.ipc.broadcast({ type: 'status', data: status });

      // Desktop notification if no clients attached
      if (!this.ipc.hasClients()) {
        const stats = this.db.getStats(sessionId);
        if (stats.events > 0 && this.cyclesRun % 10 === 0) {
          this.notify.workflowDetected(stats.tasks, `${stats.events} events so far`);
        }
      }

      await sleep(this.config.pollIntervalMs);
    }

    this.db.endSession(sessionId);
    this.ipc.stop();
    cleanup(this.config);
  }

  stop(): void {
    this.running = false;
  }

  private getStatus(sessionId: string): ShadowStatus {
    const stats = this.db.getStats(sessionId);
    return {
      pid: process.pid,
      uptime: process.uptime(),
      nodeCount: stats.nodes,
      eventCount: stats.events,
      taskCount: stats.tasks,
      pendingPrompts: 0,
      autoSave: this.config.autoSaveNodes,
      mode: this.config.shadowMode,
      agentActive: false,
      cyclesRun: this.cyclesRun,
      cyclesSkipped: this.cyclesSkipped,
    };
  }
}

// ── Daemon Lifecycle ──────────────────────────────────────────────────────────

export function forkDaemon(config: CartographyConfig): number {
  // The daemon entry is the same cli.ts but with --daemon flag via env
  const child = spawn(
    process.execPath,
    [process.argv[1] ?? 'datasynx-cartography', 'shadow', 'start', '--foreground', '--daemon-child'],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CARTOGRAPHYY_DAEMON: '1',
        CARTOGRAPHYY_CONFIG: JSON.stringify(config),
      },
    }
  );
  child.unref();

  const pid = child.pid;
  if (!pid) throw new Error('Failed to fork daemon');

  writeFileSync(config.pidFile, String(pid), 'utf8');
  return pid;
}

export function isDaemonRunning(pidFile: string): { running: boolean; pid?: number } {
  if (!existsSync(pidFile)) return { running: false };

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (isNaN(pid)) return { running: false };

    process.kill(pid, 0); // throws if process doesn't exist
    return { running: true, pid };
  } catch {
    // Stale PID file
    try { unlinkSync(pidFile); } catch { /* already gone */ }
    return { running: false };
  }
}

export function stopDaemon(pidFile: string): boolean {
  const { running, pid } = isDaemonRunning(pidFile);
  if (!running || !pid) return false;

  try {
    process.kill(pid, 'SIGTERM');
    try { unlinkSync(pidFile); } catch { /* already gone */ }
    return true;
  } catch {
    return false;
  }
}

function cleanup(config: CartographyConfig): void {
  try { unlinkSync(config.socketPath); } catch { /* already gone */ }
  try { unlinkSync(config.pidFile); } catch { /* already gone */ }
}

// ── startDaemonProcess ───────────────────────────────────────────────────────

export async function startDaemonProcess(config: CartographyConfig): Promise<void> {
  cleanStaleSocket(config.socketPath);

  const db = new CartographyDB(config.dbPath);
  const ipc = new IPCServer();
  const notify = new NotificationService(config.enableNotifications);

  ipc.start(config.socketPath);

  const daemon = new ShadowDaemon(config, db, ipc, notify);
  await daemon.run();

  db.close();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
