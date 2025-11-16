import { createClient } from 'redis';

async function run() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = createClient({ url });
  await client.connect();

  console.log('Push worker started, waiting for jobs...');
  while (true) {
    try {
      const res = await client.brPop('push:queue', 0);
      if (!res) continue;
      const payload = JSON.parse(res.element || res[1]);
      console.log('[PUSH WORKER] job received: ', payload);
      // TODO: call FCM later
      // Simulate the send delay
      await new Promise((r) => setTimeout(r, 200));
      console.log('[PUSH WORKER] job processed: ', payload.userId);
    } catch (error) {
      console.error('Push worker error', error);
      // wait a bit before retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

run().catch((e) => {
  console.error('Fatal push worker error', e);
  process.exit(1);
});
