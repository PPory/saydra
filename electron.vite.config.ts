import preact from '@preact/preset-vite'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { externalizeDeps: true }
  },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        // CJS preload keeps the renderer sandbox on
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [preact()],
    build: {
      rollupOptions: {
        input: {
          'floating-bar': resolve('src/renderer/floating-bar.html'),
          hub: resolve('src/renderer/hub.html'),
          'answer-card': resolve('src/renderer/answer-card.html')
        }
      }
    }
  }
})
