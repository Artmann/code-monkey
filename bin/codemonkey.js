#!/usr/bin/env node
const { spawn } = require('node:child_process')
const path = require('node:path')
const electron = require('electron')

const mainPath = path.join(__dirname, '..', 'dist', 'main', 'main.js')

const child = spawn(electron, [mainPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})
