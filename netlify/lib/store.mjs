// Tiny key/value store for passkeys and rate-limit counters.
// Uses Netlify Blobs in production; STUDIO_STORE=memory swaps in a Map for tests.
import { getStore } from '@netlify/blobs';

const memory = new Map();

export function store() {
  if (process.env.STUDIO_STORE === 'memory') {
    return {
      async get(key) {
        return memory.has(key) ? JSON.parse(memory.get(key)) : null;
      },
      async set(key, value) {
        memory.set(key, JSON.stringify(value));
      },
    };
  }
  const blobs = getStore({ name: 'studio-auth', consistency: 'strong' });
  return {
    get: (key) => blobs.get(key, { type: 'json' }),
    set: (key, value) => blobs.setJSON(key, value),
  };
}
