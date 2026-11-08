import { execFileSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { missingBuildEnv } from './src/buildEnv.ts'

// Latest git tag without its "v", or a dev marker when there is no tag (fresh fork, shallow clone).
function gitVersion() {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return tag.trim().replace(/^v/, '')
  } catch {
    return '0.0.0-dev'
  }
}

const version = process.env.VITE_APP_VERSION || gitVersion()

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // A build without the instance config must fail, never fall back to another project.
    const missing = missingBuildEnv(loadEnv(mode, process.cwd(), ''))
    if (missing.length > 0) throw new Error(`Missing build variables: ${missing.join(', ')} — copy .env.example to .env.local`)
  }
  return {
    plugins: [react(), tailwindcss()],
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
    test: {
      projects: [
        {
          test: {
            name: 'unit',
            include: ['src/**/*.test.ts'],
            environment: 'node',
          },
        },
        {
          test: {
            name: 'emulator',
            include: ['tests/**/*.test.ts'],
            environment: 'node',
            // The emulator is shared, so these tests must not run in parallel.
            fileParallelism: false,
            // CI runners are much slower than a laptop with a warm emulator.
            testTimeout: 30_000,
          },
        },
      ],
    },
  }
})
