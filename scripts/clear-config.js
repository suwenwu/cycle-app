/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const fs = require('fs')
const path = require('path')
const os = require('os')

const appName = 'cycle-app'

function getAppDataDir() {
  const home = os.homedir()
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName)
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', appName)
    case 'linux':
      return path.join(home, '.config', appName)
    default:
      return path.join(home, '.config', appName)
  }
}

const appDataDir = getAppDataDir()
if (fs.existsSync(appDataDir)) {
  fs.rmSync(appDataDir, { recursive: true, force: true })
  console.log(`[clear-config] removed app data dir ${appDataDir}`)
} else {
  console.log(`[clear-config] no app data dir found at ${appDataDir}`)
}
