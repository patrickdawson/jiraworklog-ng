export default async function globalTeardown(): Promise<void> {
  const mock = globalThis.__JIRA_MOCK__;
  if (mock) {
    await mock.stop();
    globalThis.__JIRA_MOCK__ = undefined;
  }
}
