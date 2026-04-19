import { buildApp } from './app.js';
import { resolveConfig } from './config.js';
import { loadEnvFiles } from './env.js';

loadEnvFiles();
const config = resolveConfig();
const app = buildApp({ config });

async function main() {
  try {
    await app.listen({
      host: config.host,
      port: config.port
    });
    console.log(`DeepSeek local API listening on http://${config.host}:${config.port}`);

    void app.deepSeekService.cleanupTrackedStartupSessions()
      .then((summary) => {
        if (!summary || !summary.candidate_count) {
          return;
        }

        console.log(
          `Startup cleanup finished: deleted ${summary.deleted_count}/${summary.candidate_count} tracked chat sessions.`
        );
      })
      .catch((error) => {
        console.error(`Startup cleanup failed: ${error.message}`);
      });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

main();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close().catch(() => {});
    process.exit(0);
  });
}
