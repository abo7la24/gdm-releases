// the older tests read English labels, whatever language Windows is set to
process.env.GDM_LANGUAGE = 'en'

export default {
  testDir: 'e2e',
  testMatch: '*.spec.mjs',
  workers: 1, // one app at a time: the extension bridge uses a fixed port
  timeout: 40000,
  reporter: 'list',
}
