#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { Command } from 'commander'
import { type CleanupReport, WorktreeJanitor, formatKb } from './agent/cleanup.js'
import { loadOrCreateToken } from './auth.js'
import { loadConfig } from './config.js'
import { startServer } from './index.js'
import { printPreflight, runPreflight } from './preflight.js'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

// OSC 0 sets the terminal's window + tab title, so the tab reads "shazam"
// rather than whatever the shell titled the command it launched us with.
function setTerminalTitle(title: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${title}\x07`)
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(command, [url], (err) => {
    if (err) console.log(`  ${DIM}(could not open a browser automatically)${RESET}`)
  })
}

const program = new Command()

program
  .name('shazam')
  .description('A single pane for the GitHub work you owe')
  .version('0.1.0')

program
  .command('serve', { isDefault: true })
  .description('Run the dashboard locally')
  .option('-p, --port <number>', 'port to listen on', (v) => Number.parseInt(v, 10))
  .option('-i, --poll <ms>', 'poll interval in milliseconds', (v) => Number.parseInt(v, 10))
  .option('--no-open', 'do not open a browser')
  .option('--skip-preflight', 'start even if required tools are missing')
  .action(async (options: { port?: number; poll?: number; open: boolean; skipPreflight?: boolean }) => {
    const config = loadConfig({ port: options.port, pollIntervalMs: options.poll })

    setTerminalTitle('shazam')

    console.log(`\n${BOLD}shazam${RESET} ${DIM}checking your toolchain${RESET}`)
    const preflight = await runPreflight(
      config.pollIntervalMs,
      config.terminalFontSize,
      config.defaultMergeMethod,
      config.defaultAgent,
    )
    printPreflight(preflight)

    if (!preflight.ok && !options.skipPreflight) {
      console.error(
        `  ${BOLD}Cannot start.${RESET} Fix the items marked ✗ above, or pass --skip-preflight.\n`,
      )
      process.exitCode = 1
      return
    }

    const token = loadOrCreateToken()
    const server = await startServer(config, preflight, token)
    const url = `${server.url}/?t=${token}`

    console.log(`  ${BOLD}Dashboard${RESET}  ${url}`)
    console.log(`  ${DIM}polling every ${Math.round(config.pollIntervalMs / 1000)}s`)
    console.log(`  config     ${config.configPath}${RESET}\n`)

    if (options.open) openBrowser(url)

    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      console.log('\nshazam: shutting down')
      setTerminalTitle('')
      await server.stop()
      process.exit(0)
    }
    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())
  })

const worktrees = program.command('worktrees').description('Manage the worktrees shazam creates')

worktrees
  .command('prune')
  .description('Remove worktrees whose PR is merged or closed, or whose issue is closed')
  .option('-n, --dry-run', 'list what would be removed, and why, without removing anything')
  .option('-g, --grace-hours <hours>', 'override worktreeCleanupGraceHours for this run', (v) =>
    Number.parseFloat(v),
  )
  .action(async (options: { dryRun?: boolean; graceHours?: number }) => {
    const config = loadConfig()
    const body = { dryRun: options.dryRun ?? false, graceHours: options.graceHours }

    // A running server knows which worktrees its sessions are in, so it does
    // the sweep. With no server there can be no sessions, and this process can.
    let report: CleanupReport
    const server = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`
    let response: Response | null = null
    try {
      response = await fetch(`${server}/api/worktrees/prune`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shazam-token': loadOrCreateToken() },
        body: JSON.stringify(body),
      })
    } catch {
      response = null
    }

    if (response) {
      if (!response.ok) {
        console.error(`shazam: the server at ${server} refused the prune (${response.status}): ${await response.text()}`)
        process.exitCode = 1
        return
      }
      console.log(`${DIM}(swept by the running server at ${server}; its log has the detail)${RESET}`)
      report = (await response.json()) as CleanupReport
    } else {
      report = await new WorktreeJanitor({
        busy: () => ({ paths: new Set(), preparingRepos: new Set() }),
        snapshot: () => null,
        log: () => {},
      }).sweep(body)
    }
    printReport(report)
  })

function printReport(report: CleanupReport): void {
  console.log(
    `\n${BOLD}Worktree cleanup${RESET}${report.dryRun ? ' (dry run)' : ''}, grace period ${report.graceHours}h`,
  )
  if (report.entries.length === 0) console.log('  no shazam worktrees found')
  for (const e of report.entries) {
    const size = e.sizeKb ? ` ${DIM}${formatKb(e.sizeKb)}${RESET}` : ''
    console.log(`  ${e.action.padEnd(12)} ${e.repo}#${e.number}${size}  ${DIM}${e.reason}${RESET}`)
    console.log(`  ${''.padEnd(12)} ${DIM}${e.path}${RESET}`)
  }
  const acted = report.entries.filter((e) => e.action === 'removed' || e.action === 'would-remove')
  console.log(
    `\n  ${acted.length} ${report.dryRun ? 'would be removed' : 'removed'}, ${formatKb(report.freedKb)} ${
      report.dryRun ? 'reclaimable' : 'freed'
    }\n`,
  )
}

await program.parseAsync(process.argv)
