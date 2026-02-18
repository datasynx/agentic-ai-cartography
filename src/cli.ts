import { Command } from 'commander';
import { checkPrerequisites, checkPollInterval } from './preflight.js';
import { CartographyDB } from './db.js';
import { defaultConfig } from './types.js';
import { runDiscovery, generateSOPs } from './agent.js';
import type { DiscoveryEvent } from './agent.js';
import { exportAll } from './exporter.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import {
  forkDaemon, isDaemonRunning, stopDaemon, pauseDaemon, resumeDaemon, startDaemonProcess,
} from './daemon.js';
import { ForegroundClient, AttachClient } from './client.js';

// ── Shared color helpers ─────────────────────────────────────────────────────
const bold    = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim     = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan    = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green   = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow  = (s: string) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const red     = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── Daemon child-process entry ────────────────────────────────────────────────
if (process.env.CARTOGRAPHYY_DAEMON === '1') {
  const config = JSON.parse(process.env.CARTOGRAPHYY_CONFIG ?? '{}') as ReturnType<typeof defaultConfig>;
  startDaemonProcess(config).catch((err) => {
    process.stderr.write(`Daemon fatal: ${err}\n`);
    process.exitCode = 1;
  });
} else {
  main();
}

function main(): void {
  const program = new Command();

  const CMD = 'datasynx-cartography';
  const VERSION = '0.2.3';

  program
    .name(CMD)
    .description('AI-powered Infrastructure Cartography & SOP Generation')
    .version(VERSION);

  // ── DISCOVERY ──────────────────────────────────────────────────────────────

  program
    .command('discover')
    .description('Infrastruktur scannen und kartographieren')
    .option('--entry <hosts...>', 'Startpunkte', ['localhost'])
    .option('--depth <n>', 'Max Tiefe', '8')
    .option('--max-turns <n>', 'Max Agent-Turns', '50')
    .option('--model <m>', 'Agent-Model', 'claude-sonnet-4-5-20250929')
    .option('--org <name>', 'Organisation (für Backstage)')
    .option('-o, --output <dir>', 'Output-Dir', './datasynx-output')
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

      const db = new CartographyDB(config.dbPath);
      const sessionId = db.createSession('discover', config);

      const w = process.stderr.write.bind(process.stderr);

      const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let spinIdx = 0;
      let spinnerTimer: ReturnType<typeof setInterval> | null = null;
      let spinnerMsg = '';

      const startSpinner = (msg: string) => {
        spinnerMsg = msg;
        if (spinnerTimer) clearInterval(spinnerTimer);
        spinnerTimer = setInterval(() => {
          const frame = cyan(SPINNER[spinIdx % SPINNER.length] ?? '⠋');
          w(`\r  ${frame} ${spinnerMsg}\x1b[K`);
          spinIdx++;
        }, 80);
      };

      const stopSpinner = () => {
        if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
        w(`\r\x1b[K`);
      };

      const startTime = Date.now();
      let turnNum = 0;
      let nodeCount = 0;
      let edgeCount = 0;

      w('\n');
      w(`  ${bold('CARTOGRAPHY')}  ${dim(config.entryPoints.join(', '))}\n`);
      w(`  ${dim('Model: ' + config.agentModel + ' | MaxTurns: ' + config.maxTurns)}\n`);
      w(dim('  ────────────────────────────────────────────────\n'));
      w('\n');

      const logLine = (icon: string, msg: string) => {
        stopSpinner();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        w(`  ${icon}  ${msg}  ${dim(elapsed + 's')}\n`);
      };

      const handleEvent = (event: DiscoveryEvent) => {
        switch (event.kind) {
          case 'turn':
            turnNum = event.turn;
            startSpinner(`Turn ${turnNum}/${config.maxTurns}  ${dim(`nodes:${nodeCount} edges:${edgeCount}`)}`);
            break;

          case 'thinking':
            if (config.verbose) {
              stopSpinner();
              const lines = event.text.split('\n').slice(0, 3);
              for (const line of lines) {
                w(`  ${dim('  ' + line.substring(0, 80))}\n`);
              }
            }
            break;

          case 'tool_call': {
            const toolName = event.tool.replace('mcp__cartograph__', '');

            if (toolName === 'Bash') {
              const cmd = (event.input['command'] as string ?? '').substring(0, 70);
              startSpinner(`${yellow('$')} ${cmd}`);
            } else if (toolName === 'save_node') {
              const id = event.input['id'] as string ?? '?';
              const type = event.input['type'] as string ?? '?';
              nodeCount++;
              logLine(green('+'), `${bold('Node')} ${cyan(id)} ${dim('(' + type + ')')}`);
              startSpinner(`Turn ${turnNum}/${config.maxTurns}  ${dim(`nodes:${nodeCount} edges:${edgeCount}`)}`);
            } else if (toolName === 'save_edge') {
              const src = event.input['sourceId'] as string ?? '?';
              const tgt = event.input['targetId'] as string ?? '?';
              const rel = event.input['relationship'] as string ?? '→';
              edgeCount++;
              logLine(magenta('~'), `${bold('Edge')} ${src} ${dim(rel)} ${cyan(tgt)}`);
              startSpinner(`Turn ${turnNum}/${config.maxTurns}  ${dim(`nodes:${nodeCount} edges:${edgeCount}`)}`);
            } else if (toolName === 'get_catalog') {
              startSpinner(`Catalog-Check ${dim('(Duplikate vermeiden)')}`);
            } else if (toolName === 'scan_bookmarks') {
              logLine(cyan('🔖'), `Browser-Lesezeichen werden gescannt…`);
              startSpinner(`scan_bookmarks`);
            } else if (toolName === 'scan_installed_apps') {
              const sh = event.input['searchHint'] as string | undefined;
              logLine(cyan('🖥'), sh ? `Installierte Apps gesucht: ${bold(sh)}` : `Alle installierten Apps werden gescannt…`);
              startSpinner(`scan_installed_apps`);
            } else if (toolName === 'ask_user') {
              // Just display; actual interaction is handled by onAskUser below
              const q = (event.input['question'] as string ?? '').substring(0, 100);
              logLine(yellow('?'), `${bold('Agent fragt:')} ${q}`);
            } else {
              startSpinner(`${toolName}...`);
            }
            break;
          }

          case 'tool_result':
            // Spinner continues, no special output for results
            break;

          case 'done':
            stopSpinner();
            break;
        }
      };

      // Human-in-the-loop: Agent kann Rückfragen stellen
      const onAskUser = async (question: string, context?: string): Promise<string> => {
        stopSpinner();
        w('\n');
        w(dim('  ────────────────────────────────────────────────\n'));
        w(`  ${yellow(bold('?'))}  ${bold('Agent fragt:')} ${question}\n`);
        if (context) w(`     ${dim(context)}\n`);

        if (!process.stdin.isTTY) {
          w(`  ${dim('(Kein Terminal — Agent fährt ohne Antwort fort)')}\n\n`);
          return '(Kein interaktiver Modus — bitte ohne diese Information fortfahren)';
        }

        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>(resolve => rl.question(`  ${cyan('→')} `, resolve));
        rl.close();
        w('\n');
        return answer || '(Keine Antwort — bitte fortfahren)';
      };

      try {
        await runDiscovery(config, db, sessionId, handleEvent, onAskUser, undefined);
      } catch (err) {
        stopSpinner();
        w(`\n  ${bold('\x1b[31m✗\x1b[0m')}  Discovery fehlgeschlagen: ${err}\n`);
        db.close();
        process.exitCode = 1;
        return;
      }

      stopSpinner();
      db.endSession(sessionId);
      const stats = db.getStats(sessionId);
      const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);

      w('\n');
      w(dim('  ────────────────────────────────────────────────\n'));
      w(`  ${green(bold('DONE'))}  ${bold(String(stats.nodes))} nodes, ${bold(String(stats.edges))} edges  ${dim('in ' + totalSec + 's')}\n`);
      w('\n');

      // ── Interactive Node Review ─────────────────────────────────────────────
      const allNodes = db.getNodes(sessionId);

      if (allNodes.length > 0 && process.stdin.isTTY) {
        w('\n');
        w(dim('  ────────────────────────────────────────────────\n'));
        w(`  ${bold('REVIEW')}  ${bold(String(allNodes.length))} entdeckte Nodes — zum Bereinigen\n`);
        w(dim('  Gib Nummern ein um Nodes zu entfernen (z.B. "1 3 5"), Enter = alles behalten\n'));
        w('\n');

        const PAD_ID = 42;
        const PAD_TYPE = 16;
        allNodes.forEach((n, i) => {
          const num = String(i + 1).padStart(3);
          const id = n.id.padEnd(PAD_ID).substring(0, PAD_ID);
          const type = dim(`[${n.type}]`.padEnd(PAD_TYPE));
          const conf = dim(`${Math.round(n.confidence * 100)}%`);
          const src = dim(n.discoveredVia === 'bookmark' ? ' 🔖' : '');
          w(`  ${dim(num)}  ${cyan('●')} ${id}  ${type}  ${conf}${src}\n`);
        });

        w('\n');
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>(resolve =>
          rl.question(`  ${yellow('?')}  Entfernen (Nummern, leer = alle behalten): `, resolve)
        );
        rl.close();

        const toRemove = answer.trim().split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= allNodes.length);
        if (toRemove.length > 0) {
          for (const idx of toRemove) {
            const node = allNodes[idx - 1];
            if (node) db.deleteNode(sessionId, node.id);
          }
          w(`\n  ${green('✓')}  ${bold(String(toRemove.length))} Node(s) entfernt\n`);
        } else {
          w(`\n  ${green('✓')}  Alle Nodes behalten\n`);
        }
      }

      // ── Export ─────────────────────────────────────────────────────────────
      exportAll(db, sessionId, config.outputDir);

      // ── Diagramm-Link ──────────────────────────────────────────────────────
      const osc8 = (url: string, label: string) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
      const htmlPath = resolve(config.outputDir, 'topology.html');
      const topoPath = resolve(config.outputDir, 'topology.mermaid');

      w('\n');
      if (existsSync(htmlPath)) {
        w(`  ${green('→')}  ${osc8(`file://${htmlPath}`, bold('topology.html öffnen'))}\n`);
      }
      if (existsSync(topoPath)) {
        try {
          const code = readFileSync(topoPath, 'utf8');
          const b64 = Buffer.from(JSON.stringify({ code, mermaid: { theme: 'dark' } })).toString('base64');
          w(`  ${cyan('→')}  ${osc8(`https://mermaid.live/view#base64:${b64}`, bold('mermaid.live öffnen'))}\n`);
        } catch { /* ignore */ }
      }
      w('\n');

      // ── Human-in-the-Loop: Follow-up Discovery Chat ───────────────────────
      if (process.stdin.isTTY) {
        w(dim('  ────────────────────────────────────────────────\n'));
        w(`  ${bold('WEITERSUCHEN')}  ${dim('Discovery interaktiv verfeinern')}\n`);
        w(dim('  Gib Suchbegriffe ein (z.B. "hubspot windsurf cursor") oder Enter zum Beenden.\n'));
        w('\n');

        // Reset event counters for follow-up rounds
        nodeCount = 0;
        edgeCount = 0;

        let continueDiscovery = true;
        while (continueDiscovery) {
          const rlFollowup = createInterface({ input: process.stdin, output: process.stderr });
          const followupHint = await new Promise<string>(resolve =>
            rlFollowup.question(`  ${yellow('→')}  Suche nach (Enter = Beenden): `, resolve)
          );
          rlFollowup.close();

          if (!followupHint.trim()) {
            continueDiscovery = false;
            break;
          }

          const followupHintTrimmed = followupHint.trim();
          w('\n');
          w(`  ${cyan(bold('⟳'))}  Suche nach: ${bold(followupHintTrimmed)}\n`);
          w('\n');

          try {
            await runDiscovery(config, db, sessionId, handleEvent, onAskUser, followupHintTrimmed);
          } catch (err) {
            stopSpinner();
            w(`\n  ${red('✗')}  Fehler: ${err}\n`);
          }

          stopSpinner();
          const followupStats = db.getStats(sessionId);
          w('\n');
          w(dim('  ────────────────────────────────────────────────\n'));
          w(`  ${green(bold('✓'))}  Gesamt jetzt: ${bold(String(followupStats.nodes))} nodes, ${bold(String(followupStats.edges))} edges\n`);
          w('\n');

          // Re-export with updated data
          exportAll(db, sessionId, config.outputDir);
          if (existsSync(htmlPath)) {
            w(`  ${green('→')}  ${osc8(`file://${htmlPath}`, bold('topology.html aktualisiert'))}\n`);
          }
          w('\n');
        }
      }

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
        process.stderr.write('❌ Shadow-Daemon läuft bereits. datasynx-cartography shadow status\n');
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
        process.stderr.write('   datasynx-cartography shadow attach  — ankoppeln\n');
        process.stderr.write('   datasynx-cartography shadow stop    — stoppen\n\n');
      }
    });

  shadow
    .command('stop')
    .description('Shadow-Daemon stoppen + SOP-Review')
    .option('-o, --output <dir>', 'Output-Dir für SOPs + Dashboard', './datasynx-output')
    .option('--no-review', 'SOP-Review überspringen')
    .action(async (opts) => {
      const config = defaultConfig({ outputDir: opts.output });
      const stopped = stopDaemon(config.pidFile);

      if (!stopped) {
        process.stderr.write('⚠ Kein laufender Shadow-Daemon gefunden\n');
        return;
      }

      process.stderr.write('✓ Shadow-Daemon gestoppt\n');

      if (opts.review === false) return;

      // Wait a moment for daemon to flush DB
      await new Promise(r => setTimeout(r, 500));

      // Generate SOPs + show review
      const db = new CartographyDB(config.dbPath);
      const session = db.getLatestSession('shadow');
      if (!session) {
        db.close();
        return;
      }

      const stats = db.getStats(session.id);
      const w = (s: string) => process.stderr.write(s);

      w('\n');
      w(dim('  ────────────────────────────────────────────────\n'));
      w(bold('  Shadow-Session Review\n'));
      w(dim(`  Session: ${session.id}\n`));
      w(dim(`  Nodes: ${stats.nodes} | Events: ${stats.events} | Tasks: ${stats.tasks}\n`));
      w(dim('  ────────────────────────────────────────────────\n'));
      w('\n');

      // Generate SOPs if tasks exist
      if (stats.tasks > 0) {
        try {
          w('  SOPs generieren...\n');
          const count = await generateSOPs(db, session.id);
          w(`  ${green('✓')} ${count} SOPs generiert\n\n`);
        } catch (err) {
          w(`  ${red('✗')} SOP-Generierung fehlgeschlagen: ${err}\n\n`);
        }
      }

      // Show SOPs as markdown review
      const { exportSOPMarkdown, exportSOPDashboard } = await import('./exporter.js');
      const sops = db.getSOPs(session.id);

      if (sops.length > 0) {
        w(bold('  SOPs zur Überprüfung:\n\n'));
        for (const sop of sops) {
          const md = exportSOPMarkdown(sop);
          // Indent each line for terminal display
          for (const line of md.split('\n')) {
            process.stdout.write(`  ${line}\n`);
          }
          process.stdout.write('\n');
          w(dim('  ────────────────────────────────────────────────\n\n'));
        }

        // Export SOP dashboard HTML
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const { join, resolve: resolvePath } = await import('node:path');

        mkdirSync(config.outputDir, { recursive: true });
        mkdirSync(join(config.outputDir, 'sops'), { recursive: true });

        // Write individual SOP markdown files
        for (const sop of sops) {
          const filename = sop.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
          writeFileSync(join(config.outputDir, 'sops', filename), exportSOPMarkdown(sop));
        }

        // Write SOP dashboard HTML
        const allSOPs = db.getAllSOPs();
        const dashboardHtml = exportSOPDashboard(allSOPs);
        const dashboardPath = join(config.outputDir, 'sop-dashboard.html');
        writeFileSync(dashboardPath, dashboardHtml);

        const absPath = resolvePath(dashboardPath);
        w(`  ${green('✓')} ${sops.length} SOP-Markdown-Dateien geschrieben\n`);
        w(`  ${green('✓')} SOP Dashboard: ${cyan(`file://${absPath}`)}\n`);
        w('\n');
        w(dim(`  Öffne im Browser: ${bold(`file://${absPath}`)}\n`));
        w('\n');
      } else {
        w(dim('  Keine SOPs in dieser Session.\n\n'));
      }

      db.close();
    });

  shadow
    .command('pause')
    .description('Shadow-Daemon pausieren')
    .action(() => {
      const config = defaultConfig();
      const paused = pauseDaemon(config.pidFile);
      if (paused) {
        process.stderr.write('⏸ Shadow-Daemon pausiert\n');
      } else {
        process.stderr.write('⚠ Kein laufender Shadow-Daemon gefunden\n');
      }
    });

  shadow
    .command('resume')
    .description('Shadow-Daemon fortsetzen')
    .action(() => {
      const config = defaultConfig();
      const resumed = resumeDaemon(config.pidFile);
      if (resumed) {
        process.stderr.write('▶ Shadow-Daemon fortgesetzt\n');
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
      const db = new CartographyDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession('shadow');

      if (!session) {
        process.stderr.write('❌ Keine Shadow-Session gefunden. datasynx-cartography shadow start\n');
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
    .option('-o, --output <dir>', 'Output-Dir', './datasynx-output')
    .option('--format <fmt...>', 'Formate: mermaid,json,yaml,html,sops')
    .action((sessionId: string | undefined, opts) => {
      const config = defaultConfig({ outputDir: opts.output });
      const db = new CartographyDB(config.dbPath);

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
      const db = new CartographyDB(config.dbPath);

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
      const db = new CartographyDB(config.dbPath);
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

  // ── OVERVIEW ──────────────────────────────────────────────────────────────

  program
    .command('overview')
    .description('Übersicht aller Cartographies + SOPs')
    .option('--db <path>', 'DB-Pfad')
    .action((opts) => {
      const config = defaultConfig();
      const db = new CartographyDB((opts as { db?: string }).db ?? config.dbPath);
      const sessions = db.getSessions();

      const b = bold, d = dim;
      const w = (s: string) => process.stdout.write(s);

      w('\n');
      w(`  ${b('CARTOGRAPHY OVERVIEW')}\n`);
      w(d('  ─────────────────────────────────────────────────────\n'));

      if (sessions.length === 0) {
        w(`  ${d('Noch keine Sessions. Starte mit:')} ${green('datasynx-cartography discover')}\n\n`);
        db.close();
        return;
      }

      // Aggregate totals
      let totalNodes = 0, totalEdges = 0, totalSops = 0;
      for (const s of sessions) {
        const st = db.getStats(s.id);
        totalNodes += st.nodes; totalEdges += st.edges;
        totalSops += db.getSOPs(s.id).length;
      }

      w(`  ${b(String(sessions.length))} Sessions · ${b(String(totalNodes))} Nodes · `);
      w(`${b(String(totalEdges))} Edges · ${b(String(totalSops))} SOPs\n\n`);

      for (const session of sessions) {
        const stats = db.getStats(session.id);
        const nodes = db.getNodes(session.id);
        const sops = db.getSOPs(session.id);
        const status = session.completedAt ? green('✓') : yellow('●');
        const age = session.startedAt.substring(0, 16).replace('T', ' ');
        const sid = cyan(session.id.substring(0, 8));

        w(`  ${status} ${sid}  ${b('[' + session.mode + ']')}  ${d(age)}\n`);
        w(`    ${d('Nodes: ' + stats.nodes + '  Edges: ' + stats.edges + '  SOPs: ' + sops.length)}\n`);

        // Node type breakdown
        const byType = new Map<string, number>();
        for (const n of nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
        if (byType.size > 0) {
          const parts = [...byType.entries()].map(([t, c]) => `${t}:${c}`).join('  ');
          w(`    ${d(parts)}\n`);
        }

        // Top nodes
        const topNodes = nodes.slice(0, 5).map(n => n.id).join(', ');
        if (topNodes) w(`    ${d('Nodes: ' + topNodes + (nodes.length > 5 ? ' …' : ''))}\n`);

        // SOPs
        for (const sop of sops.slice(0, 3)) {
          w(`    ${green('►')} ${sop.title} ${d('(' + sop.estimatedDuration + ')')}\n`);
        }
        if (sops.length > 3) w(`    ${d('… +' + (sops.length - 3) + ' weitere SOPs')}\n`);

        w('\n');
      }

      db.close();
    });

  // ── CHAT ──────────────────────────────────────────────────────────────────

  program
    .command('chat [session-id]')
    .description('Interaktiver Chat über die kartographierte Infrastruktur')
    .option('--db <path>', 'DB-Pfad')
    .option('--model <m>', 'Model', 'claude-sonnet-4-5-20250929')
    .action(async (sessionIdArg: string | undefined, opts) => {
      const config = defaultConfig();
      const db = new CartographyDB((opts as { db?: string }).db ?? config.dbPath);
      const sessions = db.getSessions();

      const session = sessionIdArg
        ? sessions.find(s => s.id.startsWith(sessionIdArg))
        : sessions.filter(s => s.completedAt).at(-1) ?? sessions.at(-1);

      if (!session) {
        process.stderr.write('Keine Session gefunden. Führe zuerst discover aus.\n');
        db.close();
        return;
      }

      const nodes = db.getNodes(session.id);
      const edges = db.getEdges(session.id);
      const sops = db.getSOPs(session.id);

      const w = (s: string) => process.stdout.write(s);

      w('\n');
      w(dim(`  ─────────────────────────────────────────────────────\n`));
      w(`  ${bold('CARTOGRAPHY CHAT')}  ${dim('Session ' + session.id.substring(0, 8))}\n`);
      w(`  ${dim(String(nodes.length) + ' Nodes · ' + edges.length + ' Edges · ' + sops.length + ' SOPs')}\n`);
      w(dim(`  ─────────────────────────────────────────────────────\n`));
      w(`  ${dim('Frage alles über deine Infrastruktur. exit = beenden.\n\n')}`);

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic();

      // Build a compact infra summary for context (avoid token overflow)
      const infraSummary = JSON.stringify({
        nodes: nodes.map(n => ({
          id: n.id, name: n.name, type: n.type,
          confidence: n.confidence,
          metadata: n.metadata,
          tags: n.tags,
        })),
        edges: edges.map(e => ({ from: e.sourceId, to: e.targetId, rel: e.relationship, conf: e.confidence })),
        sops: sops.map(s => ({ title: s.title, description: s.description, steps: s.steps.length, duration: s.estimatedDuration })),
      });

      const systemPrompt = `Du bist ein Infrastruktur-Analyst für Cartography.
Du hast Zugriff auf die vollständig kartographierte Infrastruktur dieser Session.
Beantworte Fragen präzise und hilfreich. Nutze die Daten konkret.
Du kannst SOPs erklären, Abhängigkeiten analysieren, Risiken benennen, Optimierungen vorschlagen.

INFRASTRUKTUR-SNAPSHOT (${nodes.length} Nodes, ${edges.length} Edges, ${sops.length} SOPs):
${infraSummary.substring(0, 12000)}`;

      // Multi-turn conversation history
      type MsgParam = { role: 'user' | 'assistant'; content: string };
      const history: MsgParam[] = [];

      const rl = createInterface({ input: process.stdin, output: process.stdout });

      const ask = () => new Promise<string>(resolve => rl.question(`  ${cyan('>')} `, resolve));

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let userInput: string;
        try { userInput = await ask(); } catch { break; }

        if (!userInput.trim()) continue;
        if (['exit', 'quit', ':q'].includes(userInput.trim().toLowerCase())) break;

        history.push({ role: 'user', content: userInput });

        try {
          const resp = await client.messages.create({
            model: (opts as { model: string }).model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: history,
          });

          const reply = resp.content.find(b => b.type === 'text')?.text ?? '';
          history.push({ role: 'assistant', content: reply });

          w('\n');
          // Word-wrap at 80 cols with indent
          for (const line of reply.split('\n')) {
            w(`  ${line}\n`);
          }
          w('\n');
        } catch (err) {
          w(`  ${red('✗')}  Fehler: ${err}\n\n`);
        }
      }

      rl.close();
      db.close();
      w(`\n  ${dim('Chat beendet.')}\n\n`);
    });

  // ── DOCS ──────────────────────────────────────────────────────────────────

  program
    .command('docs')
    .description('Alle Features und Befehle auf einen Blick')
    .action(() => {
      const out = process.stdout.write.bind(process.stdout);
      const b = bold;
      const line = () => out(dim('─'.repeat(60)) + '\n');

      out('\n');
      out(b('  DATASYNX CARTOGRAPHY') + '  ' + dim('v' + VERSION) + '\n');
      out(dim('  AI-powered Infrastructure Cartography & SOP Generation\n'));
      out('\n');
      line();

      // ── CARTOGRAPHY
      out(b(cyan('  CARTOGRAPHY\n')));
      out('\n');
      out(`  ${green('datasynx-cartography discover')}\n`);
      out(`    Scannt die lokale Infrastruktur (Claude Sonnet).\n`);
      out(`    Claude führt eigenständig ss, ps, curl, docker inspect, kubectl get\n`);
      out(`    aus und speichert alles in SQLite.\n`);
      out('\n');
      out(dim('    Optionen:\n'));
      out(dim('      --entry <hosts...>    Startpunkte          (default: localhost)\n'));
      out(dim('      --depth <n>           Max Tiefe            (default: 8)\n'));
      out(dim('      --max-turns <n>       Max Agent-Turns      (default: 50)\n'));
      out(dim('      --model <m>           Model                (default: claude-sonnet-4-5-...)\n'));
      out(dim('      --org <name>          Organisation für Backstage YAML\n'));
      out(dim('      -o, --output <dir>    Output-Verzeichnis   (default: ./datasynx-output)\n'));
      out(dim('      -v, --verbose         Agent-Reasoning anzeigen\n'));
      out('\n');
      out(dim('    Output:\n'));
      out(dim('      datasynx-output/\n'));
      out(dim('        catalog.json          Maschinenlesbarer Komplett-Dump\n'));
      out(dim('        catalog-info.yaml     Backstage Service-Katalog\n'));
      out(dim('        topology.mermaid      Infrastruktur-Topologie (graph TB)\n'));
      out(dim('        dependencies.mermaid  Service-Dependencies (graph LR)\n'));
      out(dim('        topology.html         Interaktiver D3.js Force-Graph\n'));
      out(dim('        sops/                 Generierte SOPs als Markdown\n'));
      out(dim('        workflows/            Workflow-Flowcharts als Mermaid\n'));
      out('\n');
      line();

      // ── SHADOW
      out(b(cyan('  SHADOW DAEMON\n')));
      out('\n');
      out(`  ${green('datasynx-cartography shadow start')}\n`);
      out(`    Startet einen Background-Daemon, der alle 30s einen System-Snapshot\n`);
      out(`    nimmt (ss + ps). Nur bei Änderung ruft er Claude Haiku auf.\n`);
      out('\n');
      out(dim('    Optionen:\n'));
      out(dim('      --interval <ms>       Poll-Intervall       (default: 30000, min: 15000)\n'));
      out(dim('      --inactivity <ms>     Task-Grenze          (default: 300000 = 5 min)\n'));
      out(dim('      --model <m>           Analysis-Model       (default: claude-haiku-4-5-...)\n'));
      out(dim('      --track-windows       Fenster-Focus tracken (benötigt xdotool)\n'));
      out(dim('      --auto-save           Nodes ohne Rückfrage speichern\n'));
      out(dim('      --no-notifications    Desktop-Notifications deaktivieren\n'));
      out(dim('      --foreground          Kein Daemon, im Terminal bleiben\n'));
      out('\n');
      out(`  ${green('datasynx-cartography shadow stop')}     ${dim('Daemon per SIGTERM beenden')}\n`);
      out(`  ${green('datasynx-cartography shadow status')}   ${dim('PID + Socket-Pfad anzeigen')}\n`);
      out(`  ${green('datasynx-cartography shadow attach')}   ${dim('Live-Events im Terminal, Hotkeys: [T] [S] [D] [Q]')}\n`);
      out('\n');
      out(dim('    Hotkeys im Attach-Modus:\n'));
      out(dim('      [T]  Neuen Task starten (mit Beschreibung)\n'));
      out(dim('      [S]  Status-Dump anzeigen (Nodes, Events, Tasks, Cycles)\n'));
      out(dim('      [D]  Trennen — Daemon läuft weiter\n'));
      out(dim('      [Q]  Daemon stoppen und beenden\n'));
      out('\n');
      line();

      // ── ANALYSE & EXPORT
      out(b(cyan('  ANALYSE & EXPORT\n')));
      out('\n');
      out(`  ${green('datasynx-cartography sops [session-id]')}\n`);
      out(`    Clustert abgeschlossene Tasks und generiert SOPs via Claude Sonnet.\n`);
      out(`    Nutzt die Anthropic Messages API (kein Agent-Loop, ein Request pro Cluster).\n`);
      out('\n');
      out(`  ${green('datasynx-cartography export [session-id]')}\n`);
      out(dim('    --format <fmt...>   mermaid, json, yaml, html, sops  (default: alle)\n'));
      out(dim('    -o, --output <dir>  Output-Verzeichnis\n'));
      out('\n');
      out(`  ${green('datasynx-cartography show [session-id]')}    ${dim('Session-Details + Node-Liste')}\n`);
      out(`  ${green('datasynx-cartography sessions')}             ${dim('Alle Sessions tabellarisch auflisten')}\n`);
      out('\n');
      line();

      // ── KOSTEN
      out(b(cyan('  KOSTEN (Richtwerte)\n')));
      out('\n');
      out(yellow('  Modus          Model    Intervall    pro Stunde   pro 8h-Tag\n'));
      out(dim('  ─────────────────────────────────────────────────────────────\n'));
      out(`  Discovery      Sonnet   einmalig     $0.15–0.50   einmalig\n`);
      out(`  Shadow         Haiku    30s          $0.12–0.36   $0.96–2.88\n`);
      out(`  Shadow         Haiku    60s          $0.06–0.18   $0.48–1.44\n`);
      out(`  Shadow (ruhig) Haiku    30s          ~$0.02       ~$0.16\n`);
      out(`  SOP-Gen        Sonnet   einmalig     $0.01–0.03   einmalig\n`);
      out('\n');
      out(dim('  * "ruhig" = Diff-Check überspringt 90%+ Cycles, wenn System unverändert\n'));
      out('\n');
      line();

      // ── ARCHITEKTUR
      out(b(cyan('  ARCHITEKTUR\n')));
      out('\n');
      out(dim('  CLI (Commander)\n'));
      out(dim('    └── Preflight: Claude CLI check + API key + Intervall-Validierung\n'));
      out(dim('        └── Agent Orchestrator (agent.ts)\n'));
      out(dim('            ├── runDiscovery()    → Claude Sonnet + Bash + MCP Tools\n'));
      out(dim('            ├── runShadowCycle()  → Claude Haiku + nur MCP Tools (kein Bash!)\n'));
      out(dim('            └── generateSOPs()    → Anthropic Messages API (kein Agent-Loop)\n'));
      out(dim('                └── Custom MCP Tools (tools.ts)\n'));
      out(dim('                    save_node, save_edge, save_event,\n'));
      out(dim('                    get_catalog, manage_task, save_sop\n'));
      out(dim('                    └── CartographyDB (SQLite WAL)\n'));
      out(dim('  Shadow Daemon (daemon.ts)\n'));
      out(dim('    ├── takeSnapshot() → ss + ps  [kein Claude!]\n'));
      out(dim('    ├── Diff-Check → nur bei Änderung: runShadowCycle()\n'));
      out(dim('    ├── IPC Server (Unix Socket ~/.cartography/daemon.sock)\n'));
      out(dim('    └── NotificationService (Desktop wenn kein Client attached)\n'));
      out('\n');
      line();

      // ── SETUP
      out(b(cyan('  SETUP\n')));
      out('\n');
      out(dim('  # 1. Claude CLI (Runtime-Dependency)\n'));
      out('  npm install -g @anthropic-ai/claude-code\n');
      out('  claude login\n');
      out('\n');
      out(dim('  # 2. API Key (falls nicht via claude login)\n'));
      out('  export ANTHROPIC_API_KEY=sk-ant-...\n');
      out('\n');
      out(dim('  # 3. Los\n'));
      out('  datasynx-cartography discover\n');
      out('  datasynx-cartography shadow start\n');
      out('\n');
      out(dim('  Daten: ~/.cartography/cartography.db\n'));
      out(dim('  Socket: ~/.cartography/daemon.sock\n'));
      out(dim('  PID:    ~/.cartography/daemon.pid\n'));
      out('\n');
    });

  // ── Bookmarks ──────────────────────────────────────────────────────────────

  program
    .command('bookmarks')
    .description('Alle Browser-Lesezeichen anzeigen (Chrome, Edge, Brave, Firefox)')
    .action(async () => {
      const { scanAllBookmarks } = await import('./bookmarks.js');
      const out = (s: string) => process.stdout.write(s);

      process.stderr.write('  Scanning bookmarks...\n\n');
      const hosts = await scanAllBookmarks();

      if (hosts.length === 0) {
        out('  (Keine Lesezeichen gefunden — Chrome, Edge, Brave und Firefox werden unterstützt)\n\n');
        return;
      }

      // Group by source browser
      const bySource = new Map<string, typeof hosts>();
      for (const h of hosts) {
        if (!bySource.has(h.source)) bySource.set(h.source, []);
        bySource.get(h.source)!.push(h);
      }

      for (const [source, entries] of bySource) {
        out(bold(cyan(`  ${source.toUpperCase()}`)) + dim(`  (${entries.length} Hosts)\n`));
        out(dim('  ─────────────────────────────────────────\n'));
        for (const h of entries) {
          const isDefault = (h.protocol === 'https' && h.port === 443) || (h.protocol === 'http' && h.port === 80);
          const portStr = isDefault ? '' : `:${h.port}`;
          out(`  ${cyan(h.protocol + '://')}${h.hostname}${dim(portStr)}\n`);
        }
        out('\n');
      }

      out(dim(`  Total: ${hosts.length} unique hosts\n\n`));
      out(dim('  Tipp: ') + 'datasynx-cartography discover' + dim(' — scannt + klassifiziert alle Lesezeichen automatisch\n\n'));
    });

  // ── Seed ───────────────────────────────────────────────────────────────────

  program
    .command('seed')
    .description('Bekannte Infrastruktur manuell eintragen (Tools, DBs, APIs, etc.)')
    .option('--file <path>', 'JSON-Datei mit Node-Definitionen einlesen')
    .option('--session <id>', 'In existierende Session eintragen (default: neue Session)')
    .option('--db <path>', 'DB-Pfad')
    .action(async (opts) => {
      const config = defaultConfig({ ...(opts.db ? { dbPath: opts.db } : {}) });
      const db = new CartographyDB(config.dbPath);
      const sessionId = opts.session ?? db.createSession('discover', config);

      const out = (s: string) => process.stdout.write(s);
      const w   = (s: string) => process.stderr.write(s);

      // ── File mode ────────────────────────────────────────────────────────
      if (opts.file) {
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(resolve(opts.file), 'utf8'));
        } catch (e) {
          w(red(`\n  ✗  Datei konnte nicht gelesen werden: ${e}\n\n`));
          process.exitCode = 1;
          return;
        }

        if (!Array.isArray(raw)) {
          w(red('\n  ✗  JSON muss ein Array sein: [{ "type": "...", "name": "...", "host": "..." }]\n\n'));
          process.exitCode = 1;
          return;
        }

        let saved = 0;
        for (const entry of raw as Record<string, unknown>[]) {
          const type = entry['type'] as string;
          const name = entry['name'] as string;
          const host = entry['host'] as string | undefined;
          const port = entry['port'] as number | undefined;
          const tags = (entry['tags'] as string[] | undefined) ?? [];
          const metadata = (entry['metadata'] as Record<string, unknown> | undefined) ?? {};

          if (!type || !name) {
            w(yellow(`  ⚠  Übersprungen (kein type/name): ${JSON.stringify(entry)}\n`));
            continue;
          }

          const id = host
            ? `${type}:${host}${port ? ':' + port : ''}`
            : `${type}:${name.toLowerCase().replace(/\s+/g, '-')}`;

          db.upsertNode(sessionId, {
            id,
            type: type as typeof import('./types.js').NODE_TYPES[number],
            name,
            discoveredVia: 'manual',
            confidence: 1.0,
            metadata: { ...metadata, ...(host ? { host } : {}), ...(port ? { port } : {}) },
            tags,
          });
          out(`  ${green('+')}  ${cyan(id)}  ${dim('(' + type + ')')}\n`);
          saved++;
        }

        db.endSession(sessionId);
        w(`\n  ${green(bold('DONE'))}  ${saved} Nodes gespeichert  ${dim('Session: ' + sessionId)}\n\n`);
        return;
      }

      // ── Interactive mode ─────────────────────────────────────────────────
      const { NODE_TYPES } = await import('./types.js');

      if (!process.stdin.isTTY) {
        w(red('\n  ✗  Interaktiver Modus benötigt ein Terminal (--file für nicht-interaktiven Betrieb)\n\n'));
        process.exitCode = 1;
        return;
      }

      w('\n');
      w(dim('  ────────────────────────────────────────────────\n'));
      w(bold('  Bekannte Infrastruktur eintragen\n'));
      w(dim('  Beispiele: Datenbanken, APIs, SaaS-Tools, Cloud-Services\n'));
      w(dim('  ────────────────────────────────────────────────\n'));
      w('\n');

      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

      let saved = 0;

      const typeList = NODE_TYPES.map((t, i) => `${dim((i + 1).toString().padStart(2))}  ${t}`).join('\n  ');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        w('\n');
        w(dim('  Node-Typen:\n'));
        w(`  ${typeList}\n\n`);

        const typeInput = (await ask(`  ${cyan('Typ')} ${dim('[Nr. oder Name, Enter=abbrechen]')}: `)).trim();
        if (!typeInput) break;

        let nodeType: string;
        const asNum = parseInt(typeInput, 10);
        if (!isNaN(asNum) && asNum >= 1 && asNum <= NODE_TYPES.length) {
          nodeType = NODE_TYPES[asNum - 1] as string;
        } else if (NODE_TYPES.includes(typeInput as typeof NODE_TYPES[number])) {
          nodeType = typeInput;
        } else {
          w(yellow(`  ⚠  Unbekannter Typ: "${typeInput}"\n`));
          continue;
        }

        const name = (await ask(`  ${cyan('Name')} ${dim('[z.B. "Prod PostgreSQL"]')}: `)).trim();
        if (!name) { w(dim('  (Abgebrochen)\n')); continue; }

        const hostRaw = (await ask(`  ${cyan('Host / IP')} ${dim('[optional, Enter=überspringen]')}: `)).trim();
        const portRaw = (await ask(`  ${cyan('Port')} ${dim('[optional]')}: `)).trim();
        const tagsRaw = (await ask(`  ${cyan('Tags')} ${dim('[komma-getrennt, optional]')}: `)).trim();

        const host = hostRaw || undefined;
        const port = portRaw ? parseInt(portRaw, 10) : undefined;
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

        const id = host
          ? `${nodeType}:${host}${port ? ':' + port : ''}`
          : `${nodeType}:${name.toLowerCase().replace(/\s+/g, '-')}`;

        db.upsertNode(sessionId, {
          id,
          type: nodeType as typeof NODE_TYPES[number],
          name,
          discoveredVia: 'manual',
          confidence: 1.0,
          metadata: { ...(host ? { host } : {}), ...(port ? { port } : {}) },
          tags,
        });
        out(`  ${green('+')}  ${cyan(id)}\n`);
        saved++;

        const again = (await ask(`  ${dim('Weiteren Node hinzufügen? [Y/n]')}: `)).trim().toLowerCase();
        if (again === 'n' || again === 'nein') break;
      }

      rl.close();
      db.endSession(sessionId);
      w('\n');
      w(dim('  ────────────────────────────────────────────────\n'));
      w(`  ${green(bold('DONE'))}  ${saved} Node${saved !== 1 ? 's' : ''} gespeichert\n`);
      w(`  ${dim('Session: ' + sessionId)}\n`);
      w(`  ${dim('Tipp: datasynx-cartography show ' + sessionId)}\n\n`);
    });

  // ── Doctor ─────────────────────────────────────────────────────────────────

  program
    .command('doctor')
    .description('Prüft ob alle Voraussetzungen erfüllt sind')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      const { existsSync, readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const out = (s: string) => process.stdout.write(s);
      const ok  = (msg: string) => out(`  \x1b[32m✓\x1b[0m  ${msg}\n`);
      const err = (msg: string) => out(`  \x1b[31m✗\x1b[0m  ${msg}\n`);
      const warn = (msg: string) => out(`  \x1b[33m⚠\x1b[0m  ${msg}\n`);
      const dim  = (s: string) => `\x1b[2m${s}\x1b[0m`;
      let allGood = true;

      out('\n  \x1b[1mDatasynx Cartography — Doctor\x1b[0m\n');
      out(dim('  ─────────────────────────────────\n'));

      // 1. Node.js Version
      const nodeVer = process.versions.node;
      const [major] = nodeVer.split('.').map(Number);
      if ((major ?? 0) >= 18) {
        ok(`Node.js ${nodeVer}`);
      } else {
        err(`Node.js ${nodeVer} — benötigt >=18`);
        allGood = false;
      }

      // 2. Claude CLI
      try {
        const v = execSync('claude --version', { stdio: 'pipe' }).toString().trim();
        ok(`Claude CLI  ${dim(v)}`);
      } catch {
        err('Claude CLI nicht gefunden — npm i -g @anthropic-ai/claude-code');
        allGood = false;
      }

      // 3. Auth
      const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
      let hasOAuth = false;
      try {
        const creds = JSON.parse(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')) as Record<string, unknown>;
        const oauth = creds['claudeAiOauth'] as Record<string, unknown> | undefined;
        hasOAuth = typeof oauth?.['accessToken'] === 'string' && oauth['accessToken'].length > 0;
      } catch { /* no creds file */ }

      if (hasApiKey) {
        ok('ANTHROPIC_API_KEY gesetzt');
      } else if (hasOAuth) {
        ok('claude login (Subscription)');
      } else {
        err('Keine Authentifizierung — claude login  oder  export ANTHROPIC_API_KEY=sk-ant-...');
        allGood = false;
      }

      // 4. kubectl — wichtig für K8s Discovery
      try {
        const v = execSync('kubectl version --client --short 2>/dev/null || kubectl version --client', { stdio: 'pipe' }).toString().split('\n')[0]?.trim() ?? '';
        ok(`kubectl  ${dim(v || '(Client OK)')}`);
      } catch {
        warn(`kubectl nicht gefunden  ${dim('— Installation: https://kubernetes.io/docs/tasks/tools/')}`);
      }

      // 5. Cloud CLIs (optional)
      const cloudClis: Array<[string, string, string]> = [
        ['aws',    'aws --version',    'AWS CLI — https://aws.amazon.com/cli/'],
        ['gcloud', 'gcloud --version', 'Google Cloud SDK — https://cloud.google.com/sdk/'],
        ['az',     'az --version',     'Azure CLI — https://aka.ms/installazurecliwindows'],
      ];
      for (const [name, cmd, hint] of cloudClis) {
        try {
          execSync(cmd, { stdio: 'pipe' });
          ok(`${name}  ${dim('(Cloud-Scanning verfügbar)')}`);
        } catch {
          warn(`${name} nicht gefunden  ${dim('— Cloud-Scan übersprungen | ' + hint)}`);
        }
      }

      // 6. Lokale Discovery-Tools
      const localTools: Array<[string, string]> = [
        ['docker', 'docker --version'],
        ['ss',     'ss --version'],
      ];
      for (const [name, cmd] of localTools) {
        try {
          execSync(cmd, { stdio: 'pipe' });
          ok(`${name}  ${dim('(Discovery-Tool)')}`);
        } catch {
          warn(`${name} nicht gefunden  ${dim('— Discovery ohne ' + name + ' eingeschränkt')}`);
        }
      }

      // 7. SQLite data dir
      const dbDir = join(home, '.cartography');
      if (existsSync(dbDir)) {
        ok(`~/.cartography  ${dim('(Daten-Verzeichnis vorhanden)')}`);
      } else {
        warn('~/.cartography existiert noch nicht  ' + dim('— wird beim ersten Start angelegt'));
      }

      out(dim('  ─────────────────────────────────\n'));
      if (allGood) {
        out('  \x1b[32m\x1b[1mAlle Checks bestanden — datasynx-cartography discover\x1b[0m\n\n');
      } else {
        out('  \x1b[31m\x1b[1mEinige Checks fehlgeschlagen. Bitte oben beheben.\x1b[0m\n\n');
        process.exitCode = 1;
      }
    });

  // ── Banner (immer anzeigen) ───────────────────────────────────────────────

  const o = (s: string) => process.stderr.write(s);
  const _b = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const _d = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const _c = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const _g = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const _m = (s: string) => `\x1b[35m${s}\x1b[0m`;

  o('\n');
  o(_c('   ____        _        ____                    ') + '\n');
  o(_c('  |  _ \\  __ _| |_ __ _/ ___| _   _ _ __ __  __') + '\n');
  o(_c('  | | | |/ _` | __/ _` \\___ \\| | | | \'_ \\\\ \\/ /') + '\n');
  o(_c('  | |_| | (_| | || (_| |___) | |_| | | | |>  < ') + '\n');
  o(_c('  |____/ \\__,_|\\__\\__,_|____/ \\__, |_| |_/_/\\_\\') + '\n');
  o(_c('                              |___/             ') + '\n');
  o('\n');
  o(_b('  Cartography') + '  ' + _d('v' + VERSION) + '\n');
  o(_d('  AI-powered Infrastructure Discovery & SOP Generation\n'));
  o(_d('  Built on Claude Agent SDK\n'));
  o('\n');

  // ── Welcome Screen (no args → Befehlsübersicht) ─────────────────────────

  if (process.argv.length <= 2) {
    o(_d('  ────────────────────────────────────────────────\n'));
    o('\n');
    o(_b('  Commands:\n'));
    o('\n');
    o(`  ${_g('discover')}             ${_d('Infrastruktur scannen (Claude Sonnet)')}\n`);
    o(`  ${_g('seed')}                 ${_d('Bekannte Tools/DBs/APIs manuell eintragen')}\n`);
    o(`  ${_g('bookmarks')}            ${_d('Browser-Lesezeichen anzeigen')}\n`);
    o(`  ${_g('shadow start')}         ${_d('Background-Daemon starten (Claude Haiku)')}\n`);
    o(`  ${_g('shadow pause')}         ${_d('Daemon pausieren')}\n`);
    o(`  ${_g('shadow resume')}        ${_d('Daemon fortsetzen')}\n`);
    o(`  ${_g('shadow stop')}          ${_d('Stoppen + SOP-Review + Dashboard')}\n`);
    o(`  ${_g('shadow status')}        ${_d('Daemon-Status anzeigen')}\n`);
    o(`  ${_g('shadow attach')}        ${_d('Live-Steuerung: [T] [S] [P] [D] [Q]')}\n`);
    o(`  ${_g('sops')} ${_d('[session]')}      ${_d('SOPs aus Workflows generieren')}\n`);
    o(`  ${_g('export')} ${_d('[session]')}    ${_d('Mermaid, JSON, YAML, HTML exportieren')}\n`);
    o(`  ${_g('show')} ${_d('[session]')}      ${_d('Session-Details anzeigen')}\n`);
    o(`  ${_g('sessions')}             ${_d('Alle Sessions auflisten')}\n`);
    o(`  ${_g('doctor')}               ${_d('Installations-Check (kubectl, aws, gcloud, az)')}\n`);
    o(`  ${_g('docs')}                 ${_d('Vollständige Dokumentation')}\n`);
    o('\n');
    o(_d('  ────────────────────────────────────────────────\n'));
    o('\n');
    o(_b('  Quick Start:\n'));
    o('\n');
    o(`  ${_m('$')} ${_b('datasynx-cartography doctor')}         ${_d('Alles bereit?')}\n`);
    o(`  ${_m('$')} ${_b('datasynx-cartography seed')}           ${_d('Bekannte Infra eintragen')}\n`);
    o(`  ${_m('$')} ${_b('datasynx-cartography discover')}       ${_d('Einmal-Scan')}\n`);
    o(`  ${_m('$')} ${_b('datasynx-cartography shadow start')}   ${_d('Dauerhaft beobachten')}\n`);
    o('\n');
    o(_d('  Doku:   datasynx-cartography docs\n'));
    o(_d('  Hilfe:  datasynx-cartography --help\n'));
    o(_d('  npm:    @datasynx/agentic-ai-cartography\n'));
    o('\n');
    return;
  }

  o(_d('  ────────────────────────────────────────────────\n'));
  o('\n');

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
