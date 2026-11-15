// REQ-323: runs fn over items with at most `limit` calls in flight, and resolves to the results in input order.
// The first rejection rejects the whole map, as Promise.all does.
async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, limit), list.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { mapLimit };
