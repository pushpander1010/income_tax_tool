// vite.config.ts
import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// folders to ignore at project root
const IGNORE = new Set(['node_modules', 'dist', 'src', 'scripts', 'worker', '.git'])

// discover subpages = top-level folders that contain an index.html
const subpages = fs
  .readdirSync(__dirname, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !IGNORE.has(d.name))
  .map((d) => d.name)
  .filter((dir) => fs.existsSync(resolve(__dirname, dir, 'index.html')))

// build Rollup inputs (main + each subpage/index.html)
const inputs: Record<string, string> = {
  main: resolve(__dirname, 'index.html'),
  ...Object.fromEntries(subpages.map((dir) => [dir, resolve(__dirname, dir, 'index.html')]))
}

export default defineConfig({
  build: {
    rollupOptions: { input: inputs }
  },
  plugins: [
    {
      name: 'copy-subpages',
      writeBundle() {
        for (const dir of subpages) {
          const srcDir = resolve(__dirname, dir)
          const destDir = resolve(__dirname, 'dist', dir)

          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true })
          }

          const srcIndex = resolve(srcDir, 'index.html')
          const destIndex = resolve(destDir, 'index.html')

          if (fs.existsSync(srcIndex)) {
            fs.copyFileSync(srcIndex, destIndex)
          }
        }
        // No _redirects file needed - Worker handles all routing
      }
    }
  ]
})
