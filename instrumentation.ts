export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { HoneycombSDK } = await import('@honeycombio/opentelemetry-node');

    const apiKey = process.env.HONEYCOMB_API_KEY;
    if (!apiKey) return;

    const sdk = new HoneycombSDK({
      apiKey,
      serviceName: 'trading-orchestrator',
      dataset: process.env.HONEYCOMB_DATASET ?? 'trading-orchestrator',
    });

    sdk.start();
  }
}
