// Deploys hosting and Firestore rules to the Firebase project given by the
// environment (VITE_FIREBASE_PROJECT_ID, and optionally FIREBASE_HOSTING_SITE).
// Extra arguments go to `firebase deploy`, e.g. `--dry-run`.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { loadEnv } from 'vite'

const env = loadEnv('production', process.cwd(), '')
const project = env.VITE_FIREBASE_PROJECT_ID
if (!project) {
  console.error('Missing VITE_FIREBASE_PROJECT_ID — copy .env.example to .env.local')
  process.exit(1)
}

const TEMP_CONFIG = 'firebase.deploy.json'
let config = 'firebase.json'
if (env.FIREBASE_HOSTING_SITE) {
  const base = JSON.parse(readFileSync('firebase.json', 'utf8'))
  base.hosting.site = env.FIREBASE_HOSTING_SITE
  writeFileSync(TEMP_CONFIG, JSON.stringify(base, null, 2))
  config = TEMP_CONFIG
}

try {
  const args = ['firebase', 'deploy', '--only', 'hosting,firestore:rules', '--project', project, '--config', config, '--non-interactive', ...process.argv.slice(2)]
  const result = spawnSync('npx', args, { stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(TEMP_CONFIG, { force: true })
}
