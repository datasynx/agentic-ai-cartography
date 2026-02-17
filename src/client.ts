import { IPCClient } from './ipc.js';
import { startDaemonProcess } from './daemon.js';
import type { CartographConfig, DaemonMessage, ShadowStatus } from './types.js';

// ── ForegroundClient ─────────────────────────────────────────────────────────
// Runs daemon + terminal UI in the same process (no fork)

export class ForegroundClient {
  async run(config: CartographConfig): Promise<void> {
    process.stderr.write('👁 Cartograph Shadow (foreground) gestartet\n');
    process.stderr.write(`   Intervall: ${config.pollIntervalMs / 1000}s | Modell: ${config.shadowModel}\n`);
    process.stderr.write('   Ctrl+C zum Beenden\n\n');

    // Run daemon inline (blocks until SIGINT/SIGTERM)
    await startDaemonProcess({ ...config, shadowMode: 'foreground' });
  }
}

// ── AttachClient ─────────────────────────────────────────────────────────────
// Connects to a running daemon via Unix socket and provides terminal UI

export class AttachClient {
  async attach(socketPath: string): Promise<void> {
    const client = new IPCClient();

    try {
      await client.connect(socketPath);
    } catch {
      process.stderr.write(`❌ Kann nicht an Daemon ankoppeln: ${socketPath}\n`);
      process.stderr.write('   Ist der Daemon gestartet? cartograph shadow status\n');
      process.exitCode = 1;
      return;
    }

    process.stderr.write('📡 Verbunden mit Shadow-Daemon\n');
    process.stderr.write('   [T] Neuer Task  [S] Status  [D] Trennen  [Q] Daemon stoppen\n\n');

    // Set raw mode for hotkeys
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key: string) => {
      const k = key.toLowerCase();

      if (k === 't') {
        process.stdout.write('\nTask-Beschreibung: ');
        // Simple readline for description
        process.stdin.once('data', (desc: string) => {
          client.send({ type: 'task-description', description: desc.trim() });
          client.send({ type: 'command', command: 'new-task' });
          process.stdout.write(`\n✓ Neuer Task gestartet: ${desc.trim()}\n`);
        });
        return;
      }

      if (k === 's') {
        client.send({ type: 'command', command: 'status' });
        return;
      }

      if (k === 'd' || k === '\u0003') {
        // Detach (Ctrl+C also)
        process.stderr.write('\n📡 Getrennt. Daemon läuft weiter.\n');
        client.disconnect();
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        return;
      }

      if (k === 'q') {
        client.send({ type: 'command', command: 'stop' });
        process.stderr.write('\n🛑 Daemon wird gestoppt...\n');
        setTimeout(() => {
          client.disconnect();
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.pause();
        }, 1000);
        return;
      }
    });

    client.on('message', (msg: DaemonMessage) => {
      switch (msg.type) {
        case 'status':
          renderStatus(msg.data);
          break;
        case 'event':
          process.stdout.write(
            `  [${new Date(msg.data.timestamp).toLocaleTimeString()}] ` +
            `${msg.data.eventType} ${msg.data.process}` +
            (msg.data.target ? ` → ${msg.data.target}` : '') + '\n'
          );
          break;
        case 'agent-output':
          if (msg.text) process.stdout.write(`  🤖 ${msg.text}\n`);
          break;
        case 'info':
          process.stdout.write(`  ℹ ${msg.message}\n`);
          break;
        case 'prompt':
          renderPrompt(msg.prompt.kind, msg.prompt.options, (answer) => {
            client.send({ type: 'prompt-response', id: msg.id, answer });
          });
          break;
      }
    });

    client.on('disconnect', () => {
      process.stderr.write('\n⚠ Verbindung zum Daemon verloren\n');
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderStatus(status: ShadowStatus): void {
  process.stdout.write(
    `\n── Shadow Status ───────────────────────────────\n` +
    `  PID: ${status.pid} | Uptime: ${Math.round(status.uptime)}s\n` +
    `  Nodes: ${status.nodeCount} | Events: ${status.eventCount} | Tasks: ${status.taskCount}\n` +
    `  Cycles: ${status.cyclesRun} run, ${status.cyclesSkipped} skipped\n` +
    `────────────────────────────────────────────────\n`
  );
}

function renderPrompt(
  kind: string,
  options: string[],
  callback: (answer: string) => void,
): void {
  process.stdout.write(`\n❓ ${kind}\n`);
  options.forEach((opt, i) => process.stdout.write(`  [${i + 1}] ${opt}\n`));
  process.stdout.write('Antwort: ');
  process.stdin.once('data', (data: string) => {
    const idx = parseInt(data.trim(), 10) - 1;
    callback(options[idx] ?? options[0] ?? '');
  });
}
