// vite.config.ts
import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// folders to ignore at project root
const IGNORE = new Set(['node_modules', 'dist', 'src', 'scripts', 'worker', '.git', 'public'])

function findIndexFiles(dir: string, baseDir: string = __dirname): string[] {
  const indexFiles: string[] = []
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    for (const item of items) {
      if (item.isDirectory() && !IGNORE.has(item.name)) {
        const fullPath = resolve(dir, item.name)
        const indexPath = resolve(fullPath, 'index.html')

        if (fs.existsSync(indexPath)) {
          // path relative to project root, used as Rollup entry key
          const relativePath = fullPath.replace(baseDir, '').replace(/\\/g, '/').replace(/^\//, '')
          indexFiles.push(relativePath)
        }

        // Recurse
        indexFiles.push(...findIndexFiles(fullPath, baseDir))
      }
    }
  } catch (e) {
  }
  return indexFiles
}

const allIndexFiles = findIndexFiles(__dirname)

const inputs: Record<string, string> = {
  main: resolve(__dirname, 'index.html'),
  ...Object.fromEntries(
    allIndexFiles.map((dir) => [dir, resolve(__dirname, dir, 'index.html')])
  ),
}

export default defineConfig({
  // This is the key: keeps URLs absolute (/...) in the built HTML
  base: '/',

  // If you host at a subpath later, change to '/subpath/' and update your HTML URLs accordingly
  publicDir: 'public', // files here are copied as-is to the root of dist

  server: {
    fs: { allow: ['..'] },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets', // where hashed assets go
    rollupOptions: { input: inputs },
  },
})
