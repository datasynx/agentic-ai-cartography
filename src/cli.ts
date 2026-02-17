import { Command } from 'commander';
import { checkPrerequisites, checkPollInterval } from './preflight.js';
import { CartographDB } from './db.js';
import { defaultConfig } from './types.js';
import { runDiscovery, generateSOPs } from './agent.js';
import { exportAll } from './exporter.js';
import {
  forkDaemon, isDaemonRunning, stopDaemon, startDaemonProcess,
} from './daemon.js';
import { ForegroundClient, AttachClient } from './client.js';

// ── Daemon child-process entry ────────────────────────────────────────────────
if (process.env.CARTOGRAPH_DAEMON === '1') {
  const config = JSON.parse(process.env.CARTOGRAPH_CONFIG ?? '{}') as ReturnType<typeof defaultConfig>;
  startDaemonProcess(config).catch((err) => {
    process.stderr.write(`Daemon fatal: ${err}\n`);
    process.exitCode = 1;
  });
} else {
  main();
}

function main(): void {
  const program = new Command();

  program
    .name('cartograph')
    .description('AI-powered Infrastructure Cartography & SOP Generation')
    .version('0.1.0');

  // ── DISCOVERY ──────────────────────────────────────────────────────────────

  program
    .command('discover')
    .description('Infrastruktur scannen und kartographieren')
    .option('--entry <hosts...>', 'Startpunkte', ['localhost'])
    .option('--depth <n>', 'Max Tiefe', '8')
    .option('--max-turns <n>', 'Max Agent-Turns', '50')
    .option('--model <m>', 'Agent-Model', 'claude-sonnet-4-5-20250929')
    .option('--org <name>', 'Organisation (für Backstage)')
    .option('-o, --output <dir>', 'Output-Dir', './cartograph-output')
    .option('--db <path>', 'DB-Pfad')
    .option('-v, --verbose', 'Agent-Reasoning anzeigen', false)
    .action(async (opts) => {
      checkPrerequisites();

      const config = defaultConfig({
        mode: 'discover',
        entryPoints: opts.entry,
        maxDepth: parseInt(opts.depth, 10),
        maxTurns: parseInt(opts.maxTurns, 10),
        agentModel: opts.model,
        organization: opts.org,
        outputDir: opts.output,
        ...(opts.db ? { dbPath: opts.db } : {}),
        verbose: opts.verbose,
      });

      const db = new CartographDB(config.dbPath);
      const sessionId = db.createSession('discover', config);

      process.stderr.write(`🔍 Scanning ${config.entryPoints.join(', ')}...\n`);
      process.stderr.write(`   Model: ${config.agentModel} | MaxTurns: ${config.maxTurns}\n\n`);

      try {
        await runDiscovery(config, db, sessionId, (text) => {
          if (config.verbose) process.stdout.write(text + '\n');
        });
      } catch (err) {
        process.stderr.write(`❌ Discovery fehlgeschlagen: ${err}\n`);
        db.close();
        process.exitCode = 1;
        return;
      }

      db.endSession(sessionId);
      const stats = db.getStats(sessionId);

      process.stderr.write(`\n✓ ${stats.nodes} nodes, ${stats.edges} edges discovered\n`);

      exportAll(db, sessionId, config.outputDir);
      process.stderr.write(`✓ Exported to: ${config.outputDir}\n`);

      db.close();
    });

  // ── SHADOW ────────────────────────────────────────────────────────────────

  const shadow = program.command('shadow').description('Shadow-Daemon verwalten');

  shadow
    .command('start')
    .description('Shadow-Daemon starten')
    .option('--interval <ms>', 'Poll-Intervall in ms', '30000')
    .option('--inactivity <ms>', 'Task-Grenze in ms', '300000')
    .option('--track-windows', 'Fenster-Focus tracken', false)
    .option('--auto-save', 'Nodes ohne Rückfrage speichern', false)
    .option('--no-notifications', 'Desktop-Notifications deaktivieren')
    .option('--model <m>', 'Analysis-Model', 'claude-haiku-4-5-20251001')
    .option('--foreground', 'Kein Daemon, im Terminal bleiben', false)
    .option('--db <path>', 'DB-Pfad')
    .option('--daemon-child', 'Internal: marks this as a daemon child process') // internal flag
    .action(async (opts) => {
      checkPrerequisites();

      const intervalMs = checkPollInterval(parseInt(opts.interval, 10));

      const config = defaultConfig({
        mode: 'shadow',
        shadowMode: opts.foreground ? 'foreground' : 'daemon',
        pollIntervalMs: intervalMs,
        inactivityTimeoutMs: parseInt(opts.inactivity, 10),
        trackWindowFocus: opts.trackWindows,
        autoSaveNodes: opts.autoSave,
        enableNotifications: opts.notifications !== false,
        shadowModel: opts.model,
        ...(opts.db ? { dbPath: opts.db } : {}),
      });

      // Check if already running
      const { running } = isDaemonRunning(config.pidFile);
      if (running) {
        process.stderr.write('❌ Shadow-Daemon läuft bereits. cartograph shadow status\n');
        process.exitCode = 1;
        return;
      }

      if (opts.foreground) {
        const client = new ForegroundClient();
        await client.run(config);
      } else {
        const pid = forkDaemon(config);
        process.stderr.write(`👁 Shadow daemon started (PID ${pid})\n`);
        process.stderr.write(`   Intervall: ${intervalMs / 1000}s | Modell: ${config.shadowModel}\n`);
        process.stderr.write('   cartograph shadow attach  — ankoppeln\n');
        process.stderr.write('   cartograph shadow stop    — stoppen\n\n');
      }
    });

  shadow
    .command('stop')
    .description('Shadow-Daemon stoppen')
    .action(() => {
      const config = defaultConfig();
      const stopped = stopDaemon(config.pidFile);
      if (stopped) {
        process.stderr.write('✓ Shadow-Daemon gestoppt\n');
      } else {
        process.stderr.write('⚠ Kein laufender Shadow-Daemon gefunden\n');
      }
    });

  shadow
    .command('status')
    .description('Shadow-Daemon Status anzeigen')
    .action(() => {
      const config = defaultConfig();
      const { running, pid } = isDaemonRunning(config.pidFile);
      if (running) {
        process.stdout.write(`✓ Shadow-Daemon läuft (PID ${pid})\n`);
        process.stdout.write(`   Socket: ${config.socketPath}\n`);
      } else {
        process.stdout.write('✗ Shadow-Daemon gestoppt\n');
      }
    });

  shadow
    .command('attach')
    .description('An laufenden Shadow-Daemon ankoppeln')
    .action(async () => {
      const config = defaultConfig();
      const client = new AttachClient();
      await client.attach(config.socketPath);
    });

  // ── ANALYSE & EXPORT ──────────────────────────────────────────────────────

  program
    .command('sops [session-id]')
    .description('SOPs aus beobachteten Workflows generieren')
    .action(async (sessionId?: string) => {
      checkPrerequisites();

      const config = defaultConfig();
      const db = new CartographDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession('shadow');

      if (!session) {
        process.stderr.write('❌ Keine Shadow-Session gefunden. cartograph shadow start\n');
        db.close();
        process.exitCode = 1;
        return;
      }

      process.stderr.write(`🔄 Generiere SOPs aus Session ${session.id}...\n`);
      const count = await generateSOPs(db, session.id);
      process.stderr.write(`✓ ${count} SOPs generiert\n`);

      db.close();
    });

  program
    .command('export [session-id]')
    .description('Alle Outputs generieren')
    .option('-o, --output <dir>', 'Output-Dir', './cartograph-output')
    .option('--format <fmt...>', 'Formate: mermaid,json,yaml,html,sops')
    .action((sessionId: string | undefined, opts) => {
      const config = defaultConfig({ outputDir: opts.output });
      const db = new CartographDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession();

      if (!session) {
        process.stderr.write('❌ Keine Session gefunden\n');
        db.close();
        process.exitCode = 1;
        return;
      }

      const formats = opts.format ?? ['mermaid', 'json', 'yaml', 'html', 'sops'];
      exportAll(db, session.id, opts.output, formats);
      process.stderr.write(`✓ Exported to: ${opts.output}\n`);

      db.close();
    });

  program
    .command('show [session-id]')
    .description('Session-Details anzeigen')
    .action((sessionId?: string) => {
      const config = defaultConfig();
      const db = new CartographDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession();

      if (!session) {
        process.stderr.write('❌ Keine Session gefunden\n');
        db.close();
        process.exitCode = 1;
        return;
      }

      const stats = db.getStats(session.id);
      const nodes = db.getNodes(session.id);

      process.stdout.write(`\nSession: ${session.id}\n`);
      process.stdout.write(`  Mode:    ${session.mode}\n`);
      process.stdout.write(`  Started: ${session.startedAt}\n`);
      if (session.completedAt) process.stdout.write(`  Ended:   ${session.completedAt}\n`);
      process.stdout.write(`  Nodes:   ${stats.nodes}\n`);
      process.stdout.write(`  Edges:   ${stats.edges}\n`);
      process.stdout.write(`  Events:  ${stats.events}\n`);
      process.stdout.write(`  Tasks:   ${stats.tasks}\n`);

      if (nodes.length > 0) {
        process.stdout.write('\n  Discovered nodes:\n');
        for (const node of nodes.slice(0, 20)) {
          process.stdout.write(`    ${node.id} (${node.type}, confidence: ${node.confidence})\n`);
        }
        if (nodes.length > 20) {
          process.stdout.write(`    ... and ${nodes.length - 20} more\n`);
        }
      }

      process.stdout.write('\n');
      db.close();
    });

  program
    .command('sessions')
    .description('Alle Sessions auflisten')
    .action(() => {
      const config = defaultConfig();
      const db = new CartographDB(config.dbPath);
      const sessions = db.getSessions();

      if (sessions.length === 0) {
        process.stdout.write('Keine Sessions gefunden\n');
        db.close();
        return;
      }

      for (const session of sessions) {
        const stats = db.getStats(session.id);
        const status = session.completedAt ? '✓' : '●';
        process.stdout.write(
          `${status} ${session.id.substring(0, 8)}  [${session.mode}]  ` +
          `${session.startedAt.substring(0, 19)}  ` +
          `nodes:${stats.nodes} edges:${stats.edges}\n`
        );
      }

      db.close();
    });

  // ── Parse ──────────────────────────────────────────────────────────────────

  program.exitOverride((err) => {
    if (err.code === 'commander.helpDisplayed') {
      process.exitCode = 0;
    } else {
      process.exitCode = 2;
    }
  });

  program.parse(process.argv);
}
