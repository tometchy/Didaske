const path = require('node:path');
const { defineConfig } = require('../../app/node_modules/@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: '**/*.spec.cjs', timeout: 60000, workers: 1,
  outputDir: '../../screenshots/results/playwright', snapshotPathTemplate: '{testDir}/baseline/{projectName}/{arg}{ext}',
  reporter: [['list'], ['html', { outputFolder: path.resolve(__dirname, '../../screenshots/report'), open: 'never' }]],
  use: { baseURL: process.env.DIDASKE_TEST_URL, browserName: 'chromium', locale: 'en-US', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  expect: { timeout: 20000, toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.001 } },
  projects: [{ name: 'desktop', use: { viewport: { width: 1280, height: 840 } } }, { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]
});
