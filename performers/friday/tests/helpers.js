// MockWorker: stand-in for the Claude CLI subprocess.
// Returns { handle, promise } matching the workerFactory contract.
// Test harness controls resolve/reject/kill via the returned controls object.

export function makeMockWorker() {
  let resolveFn, rejectFn;
  let killed = false;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const handle = {
    kill(signal) {
      killed = true;
      rejectFn(new Error('cancelled'));
    },
    get killed() { return killed; }
  };
  return {
    handle,
    promise,
    controls: {
      resolve: (v) => resolveFn(v),
      reject: (e) => rejectFn(e),
      killed: () => killed
    }
  };
}

export function mockWorkerFactory() {
  const created = [];
  function factory(prompt, ctx) {
    const m = makeMockWorker();
    created.push({ prompt, ctx, ...m });
    return { handle: m.handle, promise: m.promise };
  }
  factory.created = created;
  return factory;
}
