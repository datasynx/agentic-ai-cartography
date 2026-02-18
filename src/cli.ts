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
    .description('Scan and map your infrastructure')
    .option('--entry <hosts...>', 'Entry points', ['localhost'])
    .option('--depth <n>', 'Max crawl depth', '8')
    .option('--max-turns <n>', 'Max agent turns', '50')
    .option('--model <m>', 'Agent model', 'claude-sonnet-4-5-20250929')
    .option('--org <name>', 'Organization name (for Backstage)')
    .option('-o, --output <dir>', 'Output directory', './datasynx-output')
    .option('--db <path>', 'DB path')
    .option('-v, --verbose', 'Show agent reasoning', false)
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
              logLine(magenta('~'), `${bold('Edge')} ${cyan(src)} ${dim('─' + rel + '→')} ${cyan(tgt)}`);
              startSpinner(`Turn ${turnNum}/${config.maxTurns}  ${dim(`nodes:${nodeCount} edges:${edgeCount}`)}`);
            } else if (toolName === 'get_catalog') {
              startSpinner(`Catalog check ${dim('(avoiding duplicates)')}`);
            } else if (toolName === 'scan_bookmarks') {
              logLine(cyan('🔖'), `Scanning browser bookmarks…`);
              startSpinner(`scan_bookmarks`);
            } else if (toolName === 'scan_browser_history') {
              logLine(cyan('📜'), `Scanning browser history (anonymized hostnames only)…`);
              startSpinner(`scan_browser_history`);
            } else if (toolName === 'scan_installed_apps') {
              const sh = event.input['searchHint'] as string | undefined;
              logLine(cyan('🖥'), sh ? `Searching installed apps: ${bold(sh)}` : `Scanning all installed apps…`);
              startSpinner(`scan_installed_apps`);
            } else if (toolName === 'scan_local_databases') {
              logLine(cyan('🗄'), `Scanning local databases (PostgreSQL, MySQL, SQLite…)`);
              startSpinner(`scan_local_databases`);
            } else if (toolName === 'ask_user') {
              // Just display; actual interaction is handled by onAskUser below
              const q = (event.input['question'] as string ?? '').substring(0, 100);
              logLine(yellow('?'), `${bold('Agent asks:')} ${q}`);
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

      // Human-in-the-loop: agent can ask clarifying questions
      const onAskUser = async (question: string, context?: string): Promise<string> => {
        stopSpinner();
        w('\n');
        w(dim('  ────────────────────────────────────────────────\n'));
        w(`  ${yellow(bold('?'))}  ${bold('Agent asks:')} ${question}\n`);
        if (context) w(`     ${dim(context)}\n`);

        if (!process.stdin.isTTY) {
          w(`  ${dim('(No terminal — agent will continue without your answer)')}\n\n`);
          return '(Non-interactive mode — please continue without this information)';
        }

        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>(resolve => rl.question(`  ${cyan('→')} `, resolve));
        rl.close();
        w('\n');
        return answer || '(No answer — please continue)';
      };

      try {
        await runDiscovery(config, db, sessionId, handleEvent, onAskUser, undefined);
      } catch (err) {
        stopSpinner();
        w(`\n  ${bold('\x1b[31m✗\x1b[0m')}  Discovery failed: ${err}\n`);
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

      // ── Interactive Node & Edge Review ──────────────────────────────────────
      const allNodes = db.getNodes(sessionId);
      const allEdges = db.getEdges(sessionId);

      if (allNodes.length > 0 && process.stdin.isTTY) {
        w('\n');
        w(dim('  ────────────────────────────────────────────────\n'));
        w(`  ${bold('REVIEW')}  ${bold(String(allNodes.length))} nodes discovered\n`);
        w(dim('  Enter numbers to remove nodes (e.g. "1 3 5"), Enter = keep all\n'));
        w('\n');

        const PAD_ID = 42;
        const PAD_TYPE = 16;
        allNodes.forEach((n, i) => {
          const num = String(i + 1).padStart(3);
          const id = n.id.padEnd(PAD_ID).substring(0, PAD_ID);
          const type = dim(`[${n.type}]`.padEnd(PAD_TYPE));
          const conf = dim(`${Math.round(n.confidence * 100)}%`);
          const src = dim(n.discoveredVia === 'bookmark' ? ' 🔖' : n.discoveredVia === 'browser_history' ? ' 📜' : '');
          w(`  ${dim(num)}  ${cyan('●')} ${id}  ${type}  ${conf}${src}\n`);
        });

        // Show edges summary
        if (allEdges.length > 0) {
          w('\n');
          w(`  ${bold(String(allEdges.length))} edges (relationships):\n`);
          for (const e of allEdges.slice(0, 20)) {
            w(`  ${dim('  ')}${cyan(e.sourceId)} ${dim('─' + e.relationship + '→')} ${cyan(e.targetId)}  ${dim(Math.round(e.confidence * 100) + '%')}\n`);
          }
          if (allEdges.length > 20) w(`  ${dim('  … and ' + (allEdges.length - 20) + ' more edges')}\n`);
        }

        w('\n');
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await new Promise<string>(resolve =>
          rl.question(`  ${yellow('?')}  Remove nodes (numbers, empty = keep all): `, resolve)
        );
        rl.close();

        const toRemove = answer.trim().split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= allNodes.length);
        if (toRemove.length > 0) {
          for (const idx of toRemove) {
            const node = allNodes[idx - 1];
            if (node) db.deleteNode(sessionId, node.id);
          }
          w(`\n  ${green('✓')}  ${bold(String(toRemove.length))} node(s) removed\n`);
        } else {
          w(`\n  ${green('✓')}  All nodes kept\n`);
        }
      }

      // ── Export ─────────────────────────────────────────────────────────────
      exportAll(db, sessionId, config.outputDir);

      // ── Diagram links ───────────────────────────────────────────────────────
      const osc8 = (url: string, label: string) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
      const htmlPath = resolve(config.outputDir, 'topology.html');
      const topoPath = resolve(config.outputDir, 'topology.mermaid');

      w('\n');
      if (existsSync(htmlPath)) {
        w(`  ${green('→')}  ${osc8(`file://${htmlPath}`, bold('Open topology.html'))}\n`);
      }
      if (existsSync(topoPath)) {
        try {
          const code = readFileSync(topoPath, 'utf8');
          const b64 = Buffer.from(JSON.stringify({ code, mermaid: { theme: 'dark' } })).toString('base64');
          w(`  ${cyan('→')}  ${osc8(`https://mermaid.live/view#base64:${b64}`, bold('Open in mermaid.live'))}\n`);
        } catch { /* ignore */ }
      }
      w('\n');

      // ── Human-in-the-Loop: Follow-up Discovery Chat ───────────────────────
      if (process.stdin.isTTY) {
        w(dim('  ────────────────────────────────────────────────\n'));
        w(`  ${bold('SEARCH MORE')}  ${dim('Refine discovery interactively')}\n`);
        w(dim('  Enter search terms (e.g. "hubspot windsurf cursor") or press Enter to finish.\n'));
        w('\n');

        // Reset event counters for follow-up rounds
        nodeCount = 0;
        edgeCount = 0;

        let continueDiscovery = true;
        while (continueDiscovery) {
          const rlFollowup = createInterface({ input: process.stdin, output: process.stderr });
          const followupHint = await new Promise<string>(resolve =>
            rlFollowup.question(`  ${yellow('→')}  Search for (Enter = finish): `, resolve)
          );
          rlFollowup.close();

          if (!followupHint.trim()) {
            continueDiscovery = false;
            break;
          }

          const followupHintTrimmed = followupHint.trim();
          w('\n');
          w(`  ${cyan(bold('⟳'))}  Searching for: ${bold(followupHintTrimmed)}\n`);
          w('\n');

          try {
            await runDiscovery(config, db, sessionId, handleEvent, onAskUser, followupHintTrimmed);
          } catch (err) {
            stopSpinner();
            w(`\n  ${red('✗')}  Error: ${err}\n`);
          }

          stopSpinner();
          const followupStats = db.getStats(sessionId);
          w('\n');
          w(dim('  ────────────────────────────────────────────────\n'));
          w(`  ${green(bold('✓'))}  Total now: ${bold(String(followupStats.nodes))} nodes, ${bold(String(followupStats.edges))} edges\n`);
          w('\n');

          // Re-export with updated data
          exportAll(db, sessionId, config.outputDir);
          if (existsSync(htmlPath)) {
            w(`  ${green('→')}  ${osc8(`file://${htmlPath}`, bold('topology.html updated'))}\n`);
          }
          w('\n');
        }
      }

      db.close();
    });

  // ── SHADOW ────────────────────────────────────────────────────────────────

  const shadow = program.command('shadow').description('Manage the shadow daemon');

  shadow
    .command('start')
    .description('Start the shadow daemon')
    .option('--interval <ms>', 'Poll interval in ms', '30000')
    .option('--inactivity <ms>', 'Task boundary gap in ms', '300000')
    .option('--track-windows', 'Track window focus (requires xdotool)', false)
    .option('--auto-save', 'Save nodes without prompting', false)
    .option('--no-notifications', 'Disable desktop notifications')
    .option('--model <m>', 'Analysis model', 'claude-haiku-4-5-20251001')
    .option('--foreground', 'Run in foreground (no daemon fork)', false)
    .option('--db <path>', 'DB path')
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
        process.stderr.write('❌ Shadow daemon is already running. Use: datasynx-cartography shadow status\n');
        process.exitCode = 1;
        return;
      }

      if (opts.foreground) {
        const client = new ForegroundClient();
        await client.run(config);
      } else {
        const pid = forkDaemon(config);
        process.stderr.write(`👁 Shadow daemon started (PID ${pid})\n`);
        process.stderr.write(`   Interval: ${intervalMs / 1000}s | Model: ${config.shadowModel}\n`);
        process.stderr.write('   datasynx-cartography shadow attach  — attach to live events\n');
        process.stderr.write('   datasynx-cartography shadow stop    — stop daemon\n\n');
      }
    });

  shadow
    .command('stop')
    .description('Stop shadow daemon + SOP review')
    .option('-o, --output <dir>', 'Output directory for SOPs + dashboard', './datasynx-output')
    .option('--no-review', 'Skip SOP review')
    .action(async (opts) => {
      const config = defaultConfig({ outputDir: opts.output });
      const stopped = stopDaemon(config.pidFile);

      if (!stopped) {
        process.stderr.write('⚠ No running shadow daemon found\n');
        return;
      }

      process.stderr.write('✓ Shadow daemon stopped\n');

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
      w(bold('  Shadow Session Review\n'));
      w(dim(`  Session: ${session.id}\n`));
      w(dim(`  Nodes: ${stats.nodes} | Events: ${stats.events} | Tasks: ${stats.tasks}\n`));
      w(dim('  ────────────────────────────────────────────────\n'));
      w('\n');

      // Generate SOPs if tasks exist
      if (stats.tasks > 0) {
        try {
          w('  Generating SOPs...\n');
          const count = await generateSOPs(db, session.id);
          w(`  ${green('✓')} ${count} SOPs generated\n\n`);
        } catch (err) {
          w(`  ${red('✗')} SOP generation failed: ${err}\n\n`);
        }
      }

      // Show SOPs as markdown review
      const { exportSOPMarkdown, exportSOPDashboard } = await import('./exporter.js');
      const sops = db.getSOPs(session.id);

      if (sops.length > 0) {
        w(bold('  SOPs for review:\n\n'));
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
        w(`  ${green('✓')} ${sops.length} SOP markdown files written\n`);
        w(`  ${green('✓')} SOP Dashboard: ${cyan(`file://${absPath}`)}\n`);
        w('\n');
        w(dim(`  Open in browser: ${bold(`file://${absPath}`)}\n`));
        w('\n');
      } else {
        w(dim('  No SOPs in this session.\n\n'));
      }

      db.close();
    });

  shadow
    .command('pause')
    .description('Pause the shadow daemon')
    .action(() => {
      const config = defaultConfig();
      const paused = pauseDaemon(config.pidFile);
      if (paused) {
        process.stderr.write('⏸ Shadow daemon paused\n');
      } else {
        process.stderr.write('⚠ No running shadow daemon found\n');
      }
    });

  shadow
    .command('resume')
    .description('Resume the shadow daemon')
    .action(() => {
      const config = defaultConfig();
      const resumed = resumeDaemon(config.pidFile);
      if (resumed) {
        process.stderr.write('▶ Shadow daemon resumed\n');
      } else {
        process.stderr.write('⚠ No running shadow daemon found\n');
      }
    });

  shadow
    .command('status')
    .description('Show shadow daemon status')
    .action(() => {
      const config = defaultConfig();
      const { running, pid } = isDaemonRunning(config.pidFile);
      if (running) {
        process.stdout.write(`✓ Shadow daemon running (PID ${pid})\n`);
        process.stdout.write(`   Socket: ${config.socketPath}\n`);
      } else {
        process.stdout.write('✗ Shadow daemon stopped\n');
      }
    });

  shadow
    .command('attach')
    .description('Attach to a running shadow daemon')
    .action(async () => {
      const config = defaultConfig();
      const client = new AttachClient();
      await client.attach(config.socketPath);
    });

  // ── ANALYSE & EXPORT ──────────────────────────────────────────────────────

  program
    .command('sops [session-id]')
    .description('Generate SOPs from observed workflows')
    .action(async (sessionId?: string) => {
      checkPrerequisites();

      const config = defaultConfig();
      const db = new CartographyDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession('shadow');

      if (!session) {
        process.stderr.write('❌ No shadow session found. Run: datasynx-cartography shadow start\n');
        db.close();
        process.exitCode = 1;
        return;
      }

      process.stderr.write(`🔄 Generating SOPs from session ${session.id}...\n`);
      const count = await generateSOPs(db, session.id);
      process.stderr.write(`✓ ${count} SOPs generated\n`);

      db.close();
    });

  program
    .command('export [session-id]')
    .description('Generate all output files')
    .option('-o, --output <dir>', 'Output directory', './datasynx-output')
    .option('--format <fmt...>', 'Formats: mermaid,json,yaml,html,sops')
    .action((sessionId: string | undefined, opts) => {
      const config = defaultConfig({ outputDir: opts.output });
      const db = new CartographyDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession();

      if (!session) {
        process.stderr.write('❌ No session found\n');
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
    .description('Show session details')
    .action((sessionId?: string) => {
      const config = defaultConfig();
      const db = new CartographyDB(config.dbPath);

      const session = sessionId
        ? db.getSession(sessionId)
        : db.getLatestSession();

      if (!session) {
        process.stderr.write('❌ No session found\n');
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
    .description('List all sessions')
    .action(() => {
      const config = defaultConfig();
      const db = new CartographyDB(config.dbPath);
      const sessions = db.getSessions();

      if (sessions.length === 0) {
        process.stdout.write('No sessions found\n');
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
    .description('Overview of all cartography sessions + SOPs')
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
        w(`  ${d('No sessions yet. Start with:')} ${green('datasynx-cartography discover')}\n\n`);
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
        if (sops.length > 3) w(`    ${d('… +' + (sops.length - 3) + ' more SOPs')}\n`);

        w('\n');
      }

      db.close();
    });

  // ── CHAT ──────────────────────────────────────────────────────────────────

  program
    .command('chat [session-id]')
    .description('Interactive chat about your mapped infrastructure')
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
        process.stderr.write('No session found. Run discover first.\n');
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
      w(`  ${dim('Ask anything about your infrastructure. exit = quit.\n\n')}`);

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

      const systemPrompt = `You are an infrastructure analyst for Cartography.
You have access to the fully mapped infrastructure of this session.
Answer questions precisely and helpfully. Use the data concretely.
You can explain SOPs, analyze dependencies, identify risks, suggest optimizations.

INFRASTRUCTURE SNAPSHOT (${nodes.length} nodes, ${edges.length} edges, ${sops.length} SOPs):
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
          w(`  ${red('✗')}  Error: ${err}\n\n`);
        }
      }

      rl.close();
      db.close();
      w(`\n  ${dim('Chat ended.')}\n\n`);
    });

  // ── DOCS ──────────────────────────────────────────────────────────────────

  program
    .command('docs')
    .description('Full feature reference and all commands')
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
      out(`    Scans your local infrastructure (Claude Sonnet).\n`);
      out(`    Claude autonomously runs ss, ps, curl, docker inspect, kubectl get\n`);
      out(`    and stores everything in SQLite.\n`);
      out('\n');
      out(dim('    Options:\n'));
      out(dim('      --entry <hosts...>    Entry points         (default: localhost)\n'));
      out(dim('      --depth <n>           Max depth            (default: 8)\n'));
      out(dim('      --max-turns <n>       Max agent turns      (default: 50)\n'));
      out(dim('      --model <m>           Model                (default: claude-sonnet-4-5-...)\n'));
      out(dim('      --org <name>          Organization for Backstage YAML\n'));
      out(dim('      -o, --output <dir>    Output directory     (default: ./datasynx-output)\n'));
      out(dim('      -v, --verbose         Show agent reasoning\n'));
      out('\n');
      out(dim('    Output:\n'));
      out(dim('      datasynx-output/\n'));
      out(dim('        catalog.json          Machine-readable full dump\n'));
      out(dim('        catalog-info.yaml     Backstage service catalog\n'));
      out(dim('        topology.mermaid      Infrastructure topology (graph TB)\n'));
      out(dim('        dependencies.mermaid  Service dependencies (graph LR)\n'));
      out(dim('        topology.html         Interactive D3.js force graph\n'));
      out(dim('        sops/                 Generated SOPs as Markdown\n'));
      out(dim('        workflows/            Workflow flowcharts as Mermaid\n'));
      out('\n');
      line();

      // ── SHADOW
      out(b(cyan('  SHADOW DAEMON\n')));
      out('\n');
      out(`  ${green('datasynx-cartography shadow start')}\n`);
      out(`    Starts a background daemon that takes a system snapshot every 30s\n`);
      out(`    (ss + ps). Claude Haiku is called only when something changes.\n`);
      out('\n');
      out(dim('    Options:\n'));
      out(dim('      --interval <ms>       Poll interval        (default: 30000, min: 15000)\n'));
      out(dim('      --inactivity <ms>     Task boundary gap    (default: 300000 = 5 min)\n'));
      out(dim('      --model <m>           Analysis model       (default: claude-haiku-4-5-...)\n'));
      out(dim('      --track-windows       Track window focus (requires xdotool)\n'));
      out(dim('      --auto-save           Save nodes without prompting\n'));
      out(dim('      --no-notifications    Disable desktop notifications\n'));
      out(dim('      --foreground          Run in terminal (no daemon fork)\n'));
      out('\n');
      out(`  ${green('datasynx-cartography shadow stop')}     ${dim('Stop via SIGTERM')}\n`);
      out(`  ${green('datasynx-cartography shadow status')}   ${dim('Show PID + socket path')}\n`);
      out(`  ${green('datasynx-cartography shadow attach')}   ${dim('Live events in terminal, hotkeys: [T] [S] [D] [Q]')}\n`);
      out('\n');
      out(dim('    Hotkeys in attach mode:\n'));
      out(dim('      [T]  Start new task (with description)\n'));
      out(dim('      [S]  Show status dump (nodes, events, tasks, cycles)\n'));
      out(dim('      [D]  Detach — daemon keeps running\n'));
      out(dim('      [Q]  Stop daemon and quit\n'));
      out('\n');
      line();

      // ── ANALYSIS & EXPORT
      out(b(cyan('  ANALYSIS & EXPORT\n')));
      out('\n');
      out(`  ${green('datasynx-cartography sops [session-id]')}\n`);
      out(`    Clusters completed tasks and generates SOPs via Claude Sonnet.\n`);
      out(`    Uses the Anthropic Messages API (no agent loop, one request per cluster).\n`);
      out('\n');
      out(`  ${green('datasynx-cartography export [session-id]')}\n`);
      out(dim('    --format <fmt...>   mermaid, json, yaml, html, sops  (default: all)\n'));
      out(dim('    -o, --output <dir>  Output directory\n'));
      out('\n');
      out(`  ${green('datasynx-cartography show [session-id]')}    ${dim('Session details + node list')}\n`);
      out(`  ${green('datasynx-cartography sessions')}             ${dim('List all sessions')}\n`);
      out('\n');
      line();

      // ── COST
      out(b(cyan('  COST ESTIMATES\n')));
      out('\n');
      out(yellow('  Mode           Model    Interval     per Hour     per 8h Day\n'));
      out(dim('  ─────────────────────────────────────────────────────────────\n'));
      out(`  Discovery      Sonnet   one-shot     $0.15–0.50   one-shot\n`);
      out(`  Shadow         Haiku    30s          $0.12–0.36   $0.96–2.88\n`);
      out(`  Shadow         Haiku    60s          $0.06–0.18   $0.48–1.44\n`);
      out(`  Shadow (quiet) Haiku    30s          ~$0.02       ~$0.16\n`);
      out(`  SOP gen        Sonnet   one-shot     $0.01–0.03   one-shot\n`);
      out('\n');
      out(dim('  * "quiet" = diff-check skips 90%+ cycles when system is unchanged\n'));
      out('\n');
      line();

      // ── ARCHITECTURE
      out(b(cyan('  ARCHITECTURE\n')));
      out('\n');
      out(dim('  CLI (Commander)\n'));
      out(dim('    └── Preflight: Claude CLI check + API key + interval validation\n'));
      out(dim('        └── Agent Orchestrator (agent.ts)\n'));
      out(dim('            ├── runDiscovery()    → Claude Sonnet + Bash + MCP Tools\n'));
      out(dim('            ├── runShadowCycle()  → Claude Haiku + MCP Tools only (no Bash)\n'));
      out(dim('            └── generateSOPs()    → Anthropic Messages API (no agent loop)\n'));
      out(dim('                └── Custom MCP Tools (tools.ts)\n'));
      out(dim('                    save_node, save_edge, save_event,\n'));
      out(dim('                    scan_bookmarks, scan_browser_history,\n'));
      out(dim('                    scan_installed_apps, scan_local_databases\n'));
      out(dim('                    └── CartographyDB (SQLite WAL)\n'));
      out(dim('  Shadow Daemon (daemon.ts)\n'));
      out(dim('    ├── takeSnapshot() → ss + ps  [no Claude!]\n'));
      out(dim('    ├── Diff-Check → calls Claude only on changes\n'));
      out(dim('    ├── IPC Server (Unix socket ~/.cartography/daemon.sock)\n'));
      out(dim('    └── NotificationService (desktop alerts when no client attached)\n'));
      out('\n');
      line();

      // ── SETUP
      out(b(cyan('  SETUP\n')));
      out('\n');
      out(dim('  # 1. Claude CLI (runtime dependency)\n'));
      out('  npm install -g @anthropic-ai/claude-code\n');
      out('  claude login\n');
      out('\n');
      out(dim('  # 2. API Key (if not using claude login)\n'));
      out('  export ANTHROPIC_API_KEY=sk-ant-...\n');
      out('\n');
      out(dim('  # 3. Go\n'));
      out('  datasynx-cartography discover\n');
      out('  datasynx-cartography shadow start\n');
      out('\n');
      out(dim('  Data:   ~/.cartography/cartography.db\n'));
      out(dim('  Socket: ~/.cartography/daemon.sock\n'));
      out(dim('  PID:    ~/.cartography/daemon.pid\n'));
      out('\n');
    });

  // ── Bookmarks ──────────────────────────────────────────────────────────────

  program
    .command('bookmarks')
    .description('View all browser bookmarks (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Firefox)')
    .action(async () => {
      const { scanAllBookmarks } = await import('./bookmarks.js');
      const out = (s: string) => process.stdout.write(s);

      process.stderr.write('  Scanning bookmarks...\n\n');
      const hosts = await scanAllBookmarks();

      if (hosts.length === 0) {
        out('  (No bookmarks found — Chrome, Edge, Brave, Vivaldi, Opera and Firefox are supported)\n\n');
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
      out(dim('  Tip: ') + 'datasynx-cartography discover' + dim(' — scans + classifies all bookmarks automatically\n\n'));
    });

  // ── Seed ───────────────────────────────────────────────────────────────────

  program
    .command('seed')
    .description('Manually add known infrastructure (tools, DBs, APIs, etc.)')
    .option('--file <path>', 'JSON file with node definitions')
    .option('--session <id>', 'Add to existing session (default: new session)')
    .option('--db <path>', 'DB path')
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
          w(red(`\n  ✗  Could not read file: ${e}\n\n`));
          process.exitCode = 1;
          return;
        }

        if (!Array.isArray(raw)) {
          w(red('\n  ✗  JSON must be an array: [{ "type": "...", "name": "...", "host": "..." }]\n\n'));
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
            w(yellow(`  ⚠  Skipped (no type/name): ${JSON.stringify(entry)}\n`));
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
        w(`\n  ${green(bold('DONE'))}  ${saved} nodes saved  ${dim('Session: ' + sessionId)}\n\n`);
        return;
      }

      // ── Interactive mode ─────────────────────────────────────────────────
      const { NODE_TYPES } = await import('./types.js');

      if (!process.stdin.isTTY) {
        w(red('\n  ✗  Interactive mode requires a terminal (use --file for non-interactive)\n\n'));
        process.exitCode = 1;
        return;
      }

      w('\n');
      w(dim('  ────────────────────────────────────────────────\n'));
      w(bold('  Add known infrastructure\n'));
      w(dim('  Examples: databases, APIs, SaaS tools, cloud services\n'));
      w(dim('  ────────────────────────────────────────────────\n'));
      w('\n');

      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

      let saved = 0;

      const typeList = NODE_TYPES.map((t, i) => `${dim((i + 1).toString().padStart(2))}  ${t}`).join('\n  ');

      // eslint-disable-next-line no-constant-condition
      while (true) {
        w('\n');
        w(dim('  Node types:\n'));
        w(`  ${typeList}\n\n`);

        const typeInput = (await ask(`  ${cyan('Type')} ${dim('[number or name, Enter=cancel]')}: `)).trim();
        if (!typeInput) break;

        let nodeType: string;
        const asNum = parseInt(typeInput, 10);
        if (!isNaN(asNum) && asNum >= 1 && asNum <= NODE_TYPES.length) {
          nodeType = NODE_TYPES[asNum - 1] as string;
        } else if (NODE_TYPES.includes(typeInput as typeof NODE_TYPES[number])) {
          nodeType = typeInput;
        } else {
          w(yellow(`  ⚠  Unknown type: "${typeInput}"\n`));
          continue;
        }

        const name = (await ask(`  ${cyan('Name')} ${dim('[e.g. "Prod PostgreSQL"]')}: `)).trim();
        if (!name) { w(dim('  (Cancelled)\n')); continue; }

        const hostRaw = (await ask(`  ${cyan('Host / IP')} ${dim('[optional, Enter=skip]')}: `)).trim();
        const portRaw = (await ask(`  ${cyan('Port')} ${dim('[optional]')}: `)).trim();
        const tagsRaw = (await ask(`  ${cyan('Tags')} ${dim('[comma-separated, optional]')}: `)).trim();

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

        const again = (await ask(`  ${dim('Add another node? [Y/n]')}: `)).trim().toLowerCase();
        if (again === 'n' || again === 'no') break;
      }

      rl.close();
      db.endSession(sessionId);
      w('\n');
      w(dim('  ────────────────────────────────────────────────\n'));
      w(`  ${green(bold('DONE'))}  ${saved} node${saved !== 1 ? 's' : ''} saved\n`);
      w(`  ${dim('Session: ' + sessionId)}\n`);
      w(`  ${dim('Tip: datasynx-cartography show ' + sessionId)}\n\n`);
    });

  // ── Doctor ─────────────────────────────────────────────────────────────────

  program
    .command('doctor')
    .description('Check all requirements and cloud CLIs')
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
        err('Claude CLI not found — npm i -g @anthropic-ai/claude-code');
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
        ok('ANTHROPIC_API_KEY set');
      } else if (hasOAuth) {
        ok('claude login (subscription)');
      } else {
        err('No authentication — run: claude login  or  export ANTHROPIC_API_KEY=sk-ant-...');
        allGood = false;
      }

      // 4. kubectl — important for K8s discovery
      try {
        const v = execSync('kubectl version --client --short 2>/dev/null || kubectl version --client', { stdio: 'pipe' }).toString().split('\n')[0]?.trim() ?? '';
        ok(`kubectl  ${dim(v || '(client OK)')}`);
      } catch {
        warn(`kubectl not found  ${dim('— install: https://kubernetes.io/docs/tasks/tools/')}`);
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
          ok(`${name}  ${dim('(cloud scanning available)')}`);
        } catch {
          warn(`${name} not found  ${dim('— cloud scan skipped | ' + hint)}`);
        }
      }

      // 6. Local discovery tools
      const localTools: Array<[string, string]> = [
        ['docker', 'docker --version'],
        ['ss',     'ss --version'],
      ];
      for (const [name, cmd] of localTools) {
        try {
          execSync(cmd, { stdio: 'pipe' });
          ok(`${name}  ${dim('(discovery tool)')}`);
        } catch {
          warn(`${name} not found  ${dim('— discovery without ' + name + ' will be limited')}`);
        }
      }

      // 7. SQLite data dir
      const dbDir = join(home, '.cartography');
      if (existsSync(dbDir)) {
        ok(`~/.cartography  ${dim('(data directory exists)')}`);
      } else {
        warn('~/.cartography does not exist yet  ' + dim('— will be created on first run'));
      }

      out(dim('  ─────────────────────────────────\n'));
      if (allGood) {
        out('  \x1b[32m\x1b[1mAll checks passed — datasynx-cartography discover\x1b[0m\n\n');
      } else {
        out('  \x1b[31m\x1b[1mSome checks failed. Please fix the issues above.\x1b[0m\n\n');
        process.exitCode = 1;
      }
    });

  // ── Banner (always show) ──────────────────────────────────────────────────

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
    o(`  ${_g('discover')}             ${_d('Scan infrastructure (Claude Sonnet)')}\n`);
    o(`  ${_g('seed')}                 ${_d('Manually add known tools/DBs/APIs')}\n`);
    o(`  ${_g('bookmarks')}            ${_d('View browser bookmarks')}\n`);
    o(`  ${_g('shadow start')}         ${_d('Start background daemon (Claude Haiku)')}\n`);
    o(`  ${_g('shadow pause')}         ${_d('Pause daemon')}\n`);
    o(`  ${_g('shadow resume')}        ${_d('Resume daemon')}\n`);
    o(`  ${_g('shadow stop')}          ${_d('Stop + SOP review + dashboard')}\n`);
    o(`  ${_g('shadow status')}        ${_d('Show daemon status')}\n`);
    o(`  ${_g('shadow attach')}        ${_d('Live control: [T] [S] [P] [D] [Q]')}\n`);
    o(`  ${_g('sops')} ${_d('[session]')}      ${_d('Generate SOPs from workflows')}\n`);
    o(`  ${_g('export')} ${_d('[session]')}    ${_d('Export Mermaid, JSON, YAML, HTML')}\n`);
    o(`  ${_g('show')} ${_d('[session]')}      ${_d('Show session details')}\n`);
    o(`  ${_g('sessions')}             ${_d('List all sessions')}\n`);
    o(`  ${_g('doctor')}               ${_d('Check requirements (kubectl, aws, gcloud, az)')}\n`);
    o(`  ${_g('docs')}                 ${_d('Full feature reference')}\n`);
    o('\n');
    o(_d('  ────────────────────────────────────────────────\n'));
    o('\n');
    o(_b('  Quick Start:\n'));
    o('\n');
    o(`  ${_m('$')} ${_b('datasynx-cartography doctor')}         ${_d('Check requirements')}\n`);
    o(`  ${_m('$')} ${_b('datasynx-cartography seed')}           ${_d('Add known infrastructure')}\n`);
    o(`  ${_m('$')} ${_b('datasynx-cartography discover')}       ${_d('One-time scan')}\n`);
    o(`  ${_m('$')} ${_b('datasynx-cartography shadow start')}   ${_d('Continuous monitoring')}\n`);
    o('\n');
    o(_d('  Docs:   datasynx-cartography docs\n'));
    o(_d('  Help:   datasynx-cartography --help\n'));
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
