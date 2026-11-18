// Shared helpers for new SQL test files.
// `scenario` records a crash inside one scenario as a failure and lets the remaining scenarios run.
export function createHarness({ cleanup } = {}) {
  let failures = 0;

  const ok = (condition, message) => {
    if (condition) console.log(`ok  : ${message}`);
    else { failures++; console.error(`FAIL: ${message}`); }
  };

  const scenario = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      failures++;
      console.error(`FAIL: [${name}] crashed: ${error?.message ?? error}`);
      if (error?.where) console.error(`  where: ${String(error.where).split('\n')[0]}`);
      if (error?.query) console.error(`  query: ${String(error.query).replace(/\s+/g, ' ').slice(0, 300)}`);
    } finally {
      if (cleanup) await cleanup().catch(() => {});
    }
  };

  const finish = () => {
    if (failures > 0) {
      console.error(`${failures} failure(s)`);
      process.exitCode = 1;
    }
  };

  return { ok, scenario, finish, get failures() { return failures; } };
}
