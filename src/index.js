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
