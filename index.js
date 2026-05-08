#!/usr/bin/env node
'use strict'

const { spawnSync, spawn } = require('child_process')
const path  = require('path')
const fs    = require('fs')
const os    = require('os')
const https = require('https')
const http  = require('http')

// ── Load settings ─────────────────────────────────────────────────────────────
const settingsPath = path.join(__dirname, 'config.js')
let settings = {}
try { settings = fs.existsSync(settingsPath) ? require(settingsPath) : {} }
catch (e) { console.error('[XYLO] Cannot read config.js:', e.message); process.exit(1) }

const SESSION_ID = config.SESSION_ID || process.env.SESSION_ID || ''
const REPO       = config.REPO       || 'DAV-EX/XYLO-MD-MAIN'
const BRANCH     = settings.BRANCH     || 'main'
const CORE       = path.join(__dirname, '.xylo')

// ── Colours ───────────────────────────────────────────────────────────────────
const G  = '\x1b[32m'   // green
const BG = '\x1b[92m'   // bright green
const DG = '\x1b[90m'   // dim
const RD = '\x1b[31m'   // red
const YL = '\x1b[33m'   // yellow
const BD = '\x1b[1m'    // bold
const RS = '\x1b[0m'    // reset
const strip = s => s.replace(/\x1b\[[^m]*m/g, '')
const line  = s => process.stdout.write(strip(s) + '\n')
const nl    = ()  => process.stdout.write('\n')

// ── Header ────────────────────────────────────────────────────────────────────
function printHeader() {
  nl()
  line(`  ${BG}ﾊ ﾐ ﾋ ｰ ｳ ｼ ﾅ ﾓ ﾆ ｻ ﾜ ﾂ ｵ ﾘ ｱ ﾎ ﾃ ﾏ ｹ ﾒ ｴ ｶ ｷ ﾑ ﾕ ﾗ ｾ ﾙ ﾚ ﾛ${RS}`)
  line(`  ${G}   ﾊ    ﾐ    ﾋ    ｰ    ｳ    ｼ    ﾅ    ﾓ    ﾆ    ｻ    ﾜ    ﾂ${RS}`)
  line(`  ${DG}      ﾊ         ﾋ         ｳ         ﾅ         ﾆ         ﾜ${RS}`)
  nl()
  line(`  ${G}╔══════════════════════════════════════════════╗${RS}`)
  line(`  ${G}║${RS}  ${BG}${BD}◈  X Y L O - M D   L A U N C H E R  ◈${RS}  ${G}║${RS}`)
  line(`  ${G}╚══════════════════════════════════════════════╝${RS}`)
  nl()
}

// ── Display helpers ───────────────────────────────────────────────────────────
// Strategy: always new lines, never \r.
// Works on real TTY, Docker pseudo-TTY, Pterodactyl, Hugging Face, pipes.
const BAR_W = 24

function hollowBar(pct) {
  const n = Math.min(Math.round(pct / 100 * BAR_W), BAR_W)
  return `${G}${'▓'.repeat(n)}${DG}${'░'.repeat(BAR_W - n)}${RS}`
}

// Print a phase-start line (once per phase)
function phaseStart(stepN, total, label, detail) {
  line(`  ${DG}[${stepN}/${total}]${RS} ${BD}${label.toUpperCase().padEnd(13)}${RS} ${DG}${detail || '...'}${RS}`)
}

// Throttled status update — only prints once per interval per key
const _lastPrint = {}
function phaseUpdate(key, stepN, total, label, detail, intervalMs) {
  const now = Date.now()
  if (!_lastPrint[key] || now - _lastPrint[key] >= intervalMs) {
    _lastPrint[key] = now
    line(`  ${DG}[${stepN}/${total}]${RS} ${BD}${label.toUpperCase().padEnd(13)}${RS} ${DG}${strip(detail).slice(0,50)}${RS}`)
  }
}

// Milestone progress bar — prints at 0 / 25 / 50 / 75 / 100 % only (once each)
const _milestones = {}
function milestoneBar(stepN, total, rawPct, label, detail) {
  const bucket = Math.round(rawPct / 25) * 25
  const key = `${stepN}_${label}_${bucket}`
  if (_milestones[key]) return
  _milestones[key] = true
  const pctS = `${G}${BD}${String(bucket).padStart(3)}%${RS}`
  const tag  = `${DG}[${stepN}/${total}]${RS}`
  const lbl  = `${BD}${label.toUpperCase().padEnd(13)}${RS}`
  const det  = detail ? `  ${DG}${strip(detail).slice(0,35)}${RS}` : ''
  line(`  ${tag} ${lbl} [${hollowBar(bucket)}] ${pctS}${det}`)
}

function done(label, detail) {
  process.stdout.write(`  ${G}✔${RS}  ${BD}${label.padEnd(14)}${RS}  ${DG}${detail}${RS}\n`)
}
function fail(msg) {
  process.stdout.write(`  ${RD}✖  ${msg}${RS}\n`)
  process.exit(1)
}
function warn(msg) {
  process.stdout.write(`  ${YL}⚠${RS}  ${msg}\n`)
}

// ── Shell helpers ─────────────────────────────────────────────────────────────
function run(cmd, opts) { return spawnSync(cmd, { shell: true, stdio: 'pipe', ...opts }) }
function has(bin) { return run(`which ${bin} 2>/dev/null || where ${bin} 2>nul`).status === 0 }

// ── HTTPS download with real byte progress ────────────────────────────────────
function httpGet(url, cb) {
  const lib = url.startsWith('https') ? https : http
  lib.get(url, { headers: { 'User-Agent': 'XYLO-MD-Launcher' } }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
      return httpGet(res.headers.location, cb)
    cb(null, res)
  }).on('error', e => cb(e))
}

function downloadFile(url, dest, stepN, stepTotal) {
  return new Promise((resolve, reject) => {
    phaseStart(stepN, stepTotal, 'Downloading', 'connecting...')
    httpGet(url, (err, res) => {
      if (err) return reject(err)
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const total = parseInt(res.headers['content-length'] || '0')
      let recv = 0
      const file = fs.createWriteStream(dest)
      res.on('data', chunk => {
        recv += chunk.length
        file.write(chunk)
        const pct   = total ? recv / total * 100 : 50
        const mb    = (recv / 1048576).toFixed(1)
        const totMb = total ? (total / 1048576).toFixed(1) + ' MB' : '...'
        milestoneBar(stepN, stepTotal, pct, 'Downloading', `${mb} / ${totMb}`)
      })
      res.on('end', () => {
        file.end()
        done('Downloading', `${(recv / 1048576).toFixed(1)} MB`)
        resolve()
      })
      res.on('error', e => { file.destroy(); reject(e) })
    })
  })
}

// ── Git clone with real progress ──────────────────────────────────────────────
function gitClone(repoUrl, dest, stepN, stepTotal) {
  return new Promise((resolve, reject) => {
    phaseStart(stepN, stepTotal, 'Downloading', 'connecting to GitHub...')
    fs.mkdirSync(dest, { recursive: true })
    const child = spawn('git', ['clone', '--depth', '1', '--progress', repoUrl, dest], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buf = ''
    const parse = data => {
      buf += data.toString()
      const parts = buf.split(/[\r\n]/)
      buf = parts.pop()
      for (const ln of parts) {
        const m = ln.match(/^([\w][\w ]+?):\s+(\d+)%(?:\s+\((\d+)\/(\d+)\))?/)
        if (m) {
          const pct    = parseInt(m[2])
          const detail = m[3] ? `${m[3]} / ${m[4]}  ${m[1].trim()}` : m[1].trim()
          milestoneBar(stepN, stepTotal, pct, 'Downloading', detail)
        }
      }
    }
    child.stdout.on('data', parse)
    child.stderr.on('data', parse)
    child.on('close', code => {
      if (code === 0) { done('Downloading', 'repository cloned'); resolve() }
      else reject(new Error('git clone failed'))
    })
    child.on('error', reject)
  })
}

// ── Zip fallback ──────────────────────────────────────────────────────────────
async function downloadZip(stepN, stepTotal) {
  const url    = `https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`
  const tmpZip = path.join(os.tmpdir(), 'xylo-src.zip')
  const tmpOut = path.join(os.tmpdir(), 'xylo-extract')
  await downloadFile(url, tmpZip, stepN, stepTotal)
  phaseStart(stepN, stepTotal, 'Extracting', 'unpacking...')
  fs.mkdirSync(tmpOut, { recursive: true })
  if (run(`unzip -q "${tmpZip}" -d "${tmpOut}"`).status !== 0) fail('unzip failed — is unzip installed?')
  const extracted = fs.readdirSync(tmpOut)[0]
  if (!extracted) fail('Archive was empty.')
  fs.mkdirSync(CORE, { recursive: true })
  run(`cp -r "${path.join(tmpOut, extracted)}/." "${CORE}"`)
  try { fs.rmSync(tmpZip, { force: true }) } catch {}
  try { fs.rmSync(tmpOut, { recursive: true, force: true }) } catch {}
  done('Downloading', 'source files ready')
}

// ── Ensure source files ───────────────────────────────────────────────────────
async function ensureFiles(stepN, stepTotal) {
  if (fs.existsSync(path.join(CORE, 'package.json'))) {
    if (has('git') && fs.existsSync(path.join(CORE, '.git'))) {
      phaseStart(stepN, stepTotal, 'Source', 'checking for updates...')
      const r = run('git pull --ff-only', { cwd: CORE })
      done('Source', r.status === 0 ? 'up to date' : 'using existing files')
    } else {
      done('Source', 'files already present')
    }
    return
  }
  if (has('git')) {
    try { await gitClone(`https://github.com/${REPO}.git`, CORE, stepN, stepTotal); return }
    catch { warn('git clone failed — trying archive download'); try { fs.rmSync(CORE, { recursive: true, force: true }) } catch {} }
  }
  await downloadZip(stepN, stepTotal)
}

// ── npm install with real package progress ────────────────────────────────────
function installDeps(stepN, stepTotal) {
  return new Promise(resolve => {
    let expected = 100
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8'))
      const direct = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length
      expected = Math.max(direct * 6, 60)
    } catch {}

    let installed  = 0
    let finalCount = 0
    let lastName   = ''
    let phase      = 'resolve'
    const t0 = Date.now()

    phaseStart(stepN, stepTotal, 'Installing', 'resolving dependency tree...')

    // Heartbeat: print a new line every 30s during the silent resolve phase
    const heartbeat = setInterval(() => {
      if (phase !== 'resolve') return
      const s = Math.round((Date.now() - t0) / 1000)
      phaseUpdate(`inst_resolve`, stepN, stepTotal, 'Installing',
        `resolving dependency tree...  ${s}s`, 30_000)
    }, 30_000)

    const child = spawn('npm', ['install', '--loglevel=verbose'], {
      cwd: CORE, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
    })

    let buf = ''
    const parse = data => {
      buf += data.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const ln of lines) {
        // Final summary
        const doneM = ln.match(/added (\d+) packages?/)
        if (doneM) { finalCount = parseInt(doneM[1]); milestoneBar(stepN, stepTotal, 100, 'Installing', `${finalCount} packages`); continue }
        // Per-package extraction (real signal)
        const extM = ln.match(/timing reify:extract:node_modules\/([^\s]+)/)
        if (extM) {
          phase = 'extract'
          installed++
          if (installed > expected) expected = installed + 20
          lastName = extM[1].replace(/\/.*/, '').slice(0, 28)
          milestoneBar(stepN, stepTotal, Math.min(installed / expected * 100, 97), 'Installing', `${installed} pkgs  ${lastName}`)
          continue
        }
      }
    }

    child.stdout.on('data', parse)
    child.stderr.on('data', parse)
    child.on('close', code => {
      clearInterval(heartbeat)
      const count   = finalCount || installed || expected
      const elapsed = Math.round((Date.now() - t0) / 1000)
      done('Installing', `${count} packages  (${elapsed}s)`)
      resolve()
    })
  })
}

// ── Path sanitiser ────────────────────────────────────────────────────────────
const TOP_DIRS = new Set(['plugins', 'lib', 'src', 'commands', 'handler', 'utils'])
function sanitize(text) {
  return text.replace(
    /(?:[A-Za-z]:\\|\/)?(?:[\w.\-/\\]+[\\/])?(\S+\.(?:ts|js|mjs|cjs))(?=[\s:,)'"\n]|$)/g,
    (_, file) => {
      const parts = file.replace(/\\/g, '/').split('/')
      for (let i = parts.length - 2; i >= 0; i--)
        if (TOP_DIRS.has(parts[i])) return parts.slice(i).join('/')
      return parts.slice(-2).join('/')
    }
  )
}

// ── Build env for child ───────────────────────────────────────────────────────
function buildEnv() {
  const env = { ...process.env }
  const fwd = { SESSION_ID, PREFIX: config.PREFIX, MODE: config.MODE }
  for (const [k, v] of Object.entries(fwd))
    if (v != null && v !== '') env[k] = String(v)
  return env
}

// ── Start the bot ─────────────────────────────────────────────────────────────
let restarts = 0

function startBot(stepN, stepTotal) {
  const localTsx = path.join(CORE, 'node_modules', '.bin', 'tsx')
  let bin, args
  if      (fs.existsSync(localTsx)) { bin = 'node'; args = [localTsx, 'index.ts'] }
  else if (has('tsx'))               { bin = 'tsx';  args = ['index.ts'] }
  else                               { bin = 'npx';  args = ['--yes', 'tsx', 'index.ts'] }

  phaseStart(stepN, stepTotal, 'Launching', restarts > 0 ? `restart #${restarts}` : 'starting bot process...')

  const child = spawn(bin, args, {
    cwd: CORE, env: buildEnv(), stdio: ['inherit', 'pipe', 'pipe'],
  })

  let started = false
  const markStarted = () => {
    if (!started) { started = true; done('Launching', 'bot is running'); nl() }
  }

  child.stdout.on('data', d => { markStarted(); process.stdout.write(sanitize(d.toString())) })
  child.stderr.on('data', d => { markStarted(); process.stderr.write(sanitize(d.toString())) })
  child.on('error', e => { warn(`Launch error: ${e.message}`); scheduleRestart(stepN, stepTotal) })
  child.on('close', code => {
    if (code === 0) { process.stdout.write(`  ${G}✔${RS}  Bot exited cleanly.\n`); return }
    process.stdout.write(`  ${YL}⚠${RS}  Bot stopped (exit ${code ?? '?'})\n`)
    scheduleRestart(stepN, stepTotal)
  })
}

function scheduleRestart(stepN, stepTotal) {
  restarts++
  const delay = Math.min(5000 * restarts, 30_000)
  warn(`Restarting in ${delay / 1000}s...`)
  setTimeout(() => startBot(stepN, stepTotal), delay)
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (!SESSION_ID) {
  nl()
  process.stdout.write(`  ${RD}✖  SESSION_ID is not set.${RS}\n`)
  process.stdout.write(`     → Open ${BD}config.js${RS} and paste your session ID.\n`)
  process.stdout.write(`     → Or set ${BD}SESSION_ID${RS} as an env variable in your host panel.\n`)
  nl()
  process.exit(1)
}

;(async () => {
  printHeader()
  const needsDownload = !fs.existsSync(path.join(CORE, 'package.json'))
  const STEPS = needsDownload ? 3 : 2
  let step = 0
  try {
    step++; await ensureFiles(step, STEPS)
    step++; await installDeps(step, STEPS)
    nl()
    process.stdout.write(`  ${G}${'─'.repeat(48)}${RS}\n`)
    nl()
    step++; startBot(step, STEPS)
  } catch (e) {
    fail(`Startup failed: ${sanitize(e.message)}`)
  }
})()
