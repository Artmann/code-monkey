export const runPostinstall = async ({
  root,
  hasBetterSqlite,
  hasElectron,
  hasSourceTree,
  electronVersion,
  rebuildNativeModule,
  log
}) => {
  if (hasSourceTree) {
    return 0
  }

  if (!hasElectron) {
    log(
      'error',
      '[@artmann/codemonkey] electron is not installed; skipping native rebuild.'
    )

    return 0
  }

  if (!hasBetterSqlite) {
    log(
      'error',
      '[@artmann/codemonkey] better-sqlite3 is not installed; skipping native rebuild.'
    )

    return 0
  }

  log(
    'info',
    `[@artmann/codemonkey] rebuilding better-sqlite3 for Electron ${electronVersion}...`
  )

  try {
    await rebuildNativeModule({
      buildPath: root,
      electronVersion,
      force: true,
      mode: 'sequential',
      onlyModules: ['better-sqlite3']
    })
  } catch (error) {
    log(
      'warn',
      '[@artmann/codemonkey] native rebuild did not succeed. The app may fail to load better-sqlite3 at runtime.',
      error
    )
  }

  return 0
}
