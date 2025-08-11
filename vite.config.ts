// vite.config.ts
import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// folders to ignore at project root
const IGNORE = new Set(['node_modules', 'dist', 'src', 'scripts', 'worker', '.git'])

// recursively discover all index.html files
function findIndexFiles(dir: string, baseDir: string = __dirname): string[] {
  const indexFiles: string[] = []
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    
    for (const item of items) {
      if (item.isDirectory() && !IGNORE.has(item.name)) {
        const fullPath = resolve(dir, item.name)
        const indexPath = resolve(fullPath, 'index.html')
        
        if (fs.existsSync(indexPath)) {
          // Convert to relative path from base directory
          const relativePath = fullPath.replace(baseDir, '').replace(/\\/g, '/').replace(/^\//, '')
          indexFiles.push(relativePath)
        }
        
        // Recursively search subdirectories
        indexFiles.push(...findIndexFiles(fullPath, baseDir))
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dir}:`, error)
  }
  
  return indexFiles
}

// discover all index.html files including nested ones
const allIndexFiles = findIndexFiles(__dirname)

// build Rollup inputs (main + all discovered index.html files)
const inputs: Record<string, string> = {
  main: resolve(__dirname, 'index.html'),
  ...Object.fromEntries(
    allIndexFiles.map((dir) => [dir, resolve(__dirname, dir, 'index.html')])
  )
}

console.log('Vite discovered these entry points:', Object.keys(inputs))

export default defineConfig({
  server: {
    // Handle nested routes in development
    fs: {
      allow: ['..']
    }
  },
  build: {
    rollupOptions: { input: inputs }
  }
})
