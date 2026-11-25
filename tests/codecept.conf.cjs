exports.config = {
  name: 'Didaske public reading',
  tests: './specs/*.cjs',
  output: '../screenshots/results/codecept',
  helpers: { Playwright: { url: process.env.DIDASKE_TEST_URL, browser: 'chromium', show: false } },
  include: { reader: './dsl/reader.cjs' }
};
