import { Command } from 'commander';
import { checkPrerequisites, checkPollInterval } from './preflight.js';
import { CartographyDB } from './db.js';
import { defaultConfig } from './types.js';
import { runDiscovery, generateSOPs } from './agent.js';
import { exportAll } from './exporter.js';
import {
  forkDaemon, isDaemonRunning, stopDaemon, startDaemonProcess,
} from './daemon.js';
import { ForegroundClient, AttachClient } from './client.js';

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
  const VERSION = '0.1.3';

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

  // ── DOCS ──────────────────────────────────────────────────────────────────

  program
    .command('docs')
    .description('Alle Features und Befehle auf einen Blick')
    .action(() => {
      const out = process.stdout.write.bind(process.stdout);
      const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
      const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
      const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
      const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
      const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
      const line = () => out(dim('─'.repeat(60)) + '\n');

      out('\n');
      out(b('  DATASYNX CARTOGRAPHY') + '  ' + dim('v' + VERSION) + '\n');
      out(dim('  AI-powered Infrastructure Cartography & SOP Generation\n'));
      out('\n');
      line();

      // ── DISCOVERY
      out(b(cyan('  DISCOVERY\n')));
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

      // 4. Optionale Tools
      const optional: Array<[string, string]> = [
        ['docker', 'docker --version'],
        ['kubectl', 'kubectl version --client --short'],
        ['ss', 'ss --version'],
      ];
      for (const [name, cmd] of optional) {
        try {
          execSync(cmd, { stdio: 'pipe' });
          ok(`${name}  ${dim('(Discovery-Tool)')}`);
        } catch {
          warn(`${name} nicht gefunden  ${dim('— Discovery ohne ' + name + ' eingeschränkt')}`);
        }
      }

      // 5. SQLite data dir
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
    o(`  ${_g('shadow start')}         ${_d('Background-Daemon starten (Claude Haiku)')}\n`);
    o(`  ${_g('shadow stop')}          ${_d('Daemon stoppen')}\n`);
    o(`  ${_g('shadow status')}        ${_d('Daemon-Status anzeigen')}\n`);
    o(`  ${_g('shadow attach')}        ${_d('Live an Daemon ankoppeln')}\n`);
    o(`  ${_g('sops')} ${_d('[session]')}      ${_d('SOPs aus Workflows generieren')}\n`);
    o(`  ${_g('export')} ${_d('[session]')}    ${_d('Mermaid, JSON, YAML, HTML exportieren')}\n`);
    o(`  ${_g('show')} ${_d('[session]')}      ${_d('Session-Details anzeigen')}\n`);
    o(`  ${_g('sessions')}             ${_d('Alle Sessions auflisten')}\n`);
    o(`  ${_g('doctor')}               ${_d('Installations-Check')}\n`);
    o(`  ${_g('docs')}                 ${_d('Vollständige Dokumentation')}\n`);
    o('\n');
    o(_d('  ────────────────────────────────────────────────\n'));
    o('\n');
    o(_b('  Quick Start:\n'));
    o('\n');
    o(`  ${_m('$')} ${_b('datasynx-cartography doctor')}         ${_d('Alles bereit?')}\n`);
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
