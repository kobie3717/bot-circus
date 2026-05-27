export class TaskPool {
  constructor({ maxConcurrent = 5, workerFactory, logger, onResult, onError }) {
    this.maxConcurrent = maxConcurrent;
    this.workerFactory = workerFactory;
    this.logger = logger;
    this.onResult = onResult;
    this.onError = onError;
    this._tasks = new Map();
    this._nextId = 1;
  }

  spawn(prompt, ctx, replyToMessageId) {
    if (this._tasks.size >= this.maxConcurrent) {
      return { taskId: null, accepted: false };
    }
    const taskId = this._nextId++;
    const startedAt = Date.now();
    const { handle, promise } = this.workerFactory(prompt, ctx);
    const record = { id: taskId, prompt, ctx, replyToMessageId, startedAt, handle };
    this._tasks.set(taskId, record);

    promise.then(
      (result) => {
        this._tasks.delete(taskId);
        this.onResult?.(record, result);
      },
      (err) => {
        this._tasks.delete(taskId);
        this.onError?.(record, err);
      }
    );

    return { taskId, accepted: true };
  }

  cancel(taskId) {
    const record = this._tasks.get(taskId);
    if (!record) return false;
    try { record.handle.kill('SIGTERM'); } catch { /* worker already gone */ }
    return true;
  }

  cancelAll() {
    const ids = [...this._tasks.keys()];
    for (const id of ids) this.cancel(id);
    return ids.length;
  }

  runningCount() {
    return this._tasks.size;
  }

  status() {
    const now = Date.now();
    return [...this._tasks.values()].map(r => ({
      id: r.id,
      prompt: r.prompt,
      startedAt: r.startedAt,
      elapsedMs: now - r.startedAt
    }));
  }

  isFull() {
    return this._tasks.size >= this.maxConcurrent;
  }
}
