module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    ...(process.env.EXPO_PROJECT_ID ? { eas: { ...(config.extra?.eas ?? {}), projectId: process.env.EXPO_PROJECT_ID } } : {}),
  },
})
