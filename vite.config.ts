import { defineConfig } from 'vite'
import { resolve } from 'path'
import fs from 'fs'

// Get all subpage directories
const subpages = fs.readdirSync('.')
  .filter(item => fs.statSync(item).isDirectory())
  .filter(dir => !['node_modules', 'dist', 'src', 'scripts', 'worker', '.git'].includes(dir))
  .filter(dir => fs.existsSync(resolve(dir, 'index.html')))

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...Object.fromEntries(
          subpages.map(dir => [dir, resolve(__dirname, dir, 'index.html')])
        )
      }
    }
  },
  plugins: [
    {
      name: 'copy-subpages',
      writeBundle() {
        // Copy subpage directories to dist
        subpages.forEach(dir => {
          const srcDir = resolve(__dirname, dir)
          const destDir = resolve(__dirname, 'dist', dir)
          
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true })
          }
          
          // Copy index.html
          if (fs.existsSync(resolve(srcDir, 'index.html'))) {
            fs.copyFileSync(resolve(srcDir, 'index.html'), resolve(destDir, 'index.html'))
          }
        })
        
        // No _redirects file needed - Worker handles all routing
      }
    }
  ]
})
