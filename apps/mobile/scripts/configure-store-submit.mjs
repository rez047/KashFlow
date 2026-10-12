import { readFile, writeFile } from 'node:fs/promises'

const easProjectId = process.env.EXPO_PROJECT_ID
const appStoreConnectAppId = process.env.IOS_ASC_APP_ID
const appleTeamId = process.env.APPLE_TEAM_ID

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(easProjectId ?? '')) {
  throw new Error('Set EXPO_PROJECT_ID to the UUID of the linked EAS project.')
}

const appJsonPath = new URL('../app.json', import.meta.url)
const appJson = JSON.parse(await readFile(appJsonPath, 'utf8'))
appJson.expo.extra ??= {}
appJson.expo.extra.eas = { ...appJson.expo.extra.eas, projectId: easProjectId }
await writeFile(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

if (Boolean(appStoreConnectAppId) !== Boolean(appleTeamId)) {
  throw new Error('Set both IOS_ASC_APP_ID and APPLE_TEAM_ID, or leave both unset for Android-only submission.')
}

if (appStoreConnectAppId && appleTeamId) {
  if (!/^\d+$/.test(appStoreConnectAppId)) {
    throw new Error('Set IOS_ASC_APP_ID to the App Store Connect Apple ID.')
  }
  if (!/^[A-Z0-9]{10}$/.test(appleTeamId)) {
    throw new Error('Set APPLE_TEAM_ID to the 10-character Apple Developer Team ID.')
  }

  const easJsonPath = new URL('../eas.json', import.meta.url)
  const easJson = JSON.parse(await readFile(easJsonPath, 'utf8'))
  easJson.submit ??= {}
  easJson.submit.production ??= {}
  easJson.submit.production.ios = {
    ...easJson.submit.production.ios,
    ascAppId: appStoreConnectAppId,
    appleTeamId,
  }
  await writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`)
}
