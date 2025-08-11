import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// Get all subpage directories
const subpages = fs.readdirSync(rootDir)
  .filter(item => fs.statSync(path.join(rootDir, item)).isDirectory())
  .filter(dir => !['node_modules', 'dist', 'src', 'scripts', 'worker', '.git'].includes(dir))
  .filter(dir => fs.existsSync(path.join(rootDir, dir, 'index.html')))

console.log('Found subpages:', subpages)

// Copy subpage directories to dist
subpages.forEach(dir => {
  const srcDir = path.join(rootDir, dir)
  const destDir = path.join(rootDir, 'dist', dir)
  
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
    console.log(`Created directory: ${destDir}`)
  }
  
  // Copy index.html
  if (fs.existsSync(path.join(srcDir, 'index.html'))) {
    fs.copyFileSync(
      path.join(srcDir, 'index.html'),
      path.join(destDir, 'index.html')
    )
    console.log(`Copied: ${dir}/index.html`)
  }
})

// Copy _redirects file
if (fs.existsSync(path.join(rootDir, 'public', '_redirects'))) {
  fs.copyFileSync(
    path.join(rootDir, 'public', '_redirects'),
    path.join(rootDir, 'dist', '_redirects')
  )
  console.log('Copied: _redirects')
}

console.log('All subpages copied successfully!')
