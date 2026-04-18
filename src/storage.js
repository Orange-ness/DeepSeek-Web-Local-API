import fs from 'node:fs/promises';
import path from 'node:path';

export class SessionStore {
  constructor(config) {
    this.config = config;
    this.sessionFile = path.join(config.dataDir, 'session.json');
    this.userDataDir = path.join(config.dataDir, 'chromium-profile');
  }

  async ensure() {
    await fs.mkdir(this.config.dataDir, { recursive: true });
  }

  async load() {
    try {
      const raw = await fs.readFile(this.sessionFile, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async save(session) {
    await this.ensure();
    await fs.writeFile(this.sessionFile, JSON.stringify(session, null, 2));
    return session;
  }

  async clear() {
    await fs.rm(this.sessionFile, { force: true });
    await fs.rm(this.userDataDir, { recursive: true, force: true });
  }
}
