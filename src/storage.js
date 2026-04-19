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

export class PendingChatSessionStore {
  constructor(config) {
    this.config = config;
    this.pendingFile = path.join(config.dataDir, 'pending-chat-sessions.json');
  }

  async ensure() {
    await fs.mkdir(this.config.dataDir, { recursive: true });
  }

  async load() {
    try {
      const raw = await fs.readFile(this.pendingFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async save(entries) {
    await this.ensure();
    await fs.writeFile(this.pendingFile, JSON.stringify(entries, null, 2));
    return entries;
  }

  async list() {
    return this.load();
  }

  async add(entry) {
    const entries = await this.load();
    const existingIndex = entries.findIndex((item) => item.id === entry.id);
    const normalized = {
      id: entry.id,
      created_at: entry.created_at || new Date().toISOString(),
      source: entry.source || 'api'
    };

    if (existingIndex === -1) {
      entries.push(normalized);
    } else {
      entries[existingIndex] = {
        ...entries[existingIndex],
        ...normalized
      };
    }

    await this.save(entries);
    return normalized;
  }

  async remove(id) {
    const entries = await this.load();
    const nextEntries = entries.filter((entry) => entry.id !== id);
    if (nextEntries.length !== entries.length) {
      await this.save(nextEntries);
    }
    return nextEntries;
  }

  async clear() {
    await fs.rm(this.pendingFile, { force: true });
  }
}
