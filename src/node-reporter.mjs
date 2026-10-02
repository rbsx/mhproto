// Node's reporter receives structured events, so skipped/missing tests cannot count as passes.
export default async function* reporter(events) {
  for await (const event of events) {
    if (['test:pass', 'test:fail'].includes(event.type)) {
      const { name, skip, details } = event.data;
      yield JSON.stringify({ type: event.type, name, skip: Boolean(skip), message: details?.error?.message ?? null }) + '\n';
    }
  }
}
