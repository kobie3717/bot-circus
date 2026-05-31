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

  spawn(opts) {
    // Support both old API (prompt, ctx, replyToMessageId) and new API ({ prompt, sessionId, chatId, onResult, onError })
    let prompt, sessionId, chatId, onResult, onError, ctx, replyToMessageId;

    if (typeof opts === 'string') {
      // Old API: spawn(prompt, ctx, replyToMessageId)
      prompt = opts;
      ctx = arguments[1];
      replyToMessageId = arguments[2];
      sessionId = null;
      chatId = ctx?.chat?.id;
      onResult = this.onResult;
      onError = this.onError;
    } else {
      // New API: spawn({ prompt, sessionId, chatId, onResult, onError })
      ({ prompt, sessionId, chatId, onResult, onError } = opts);
      ctx = { chat: { id: chatId } };
      replyToMessageId = null;
      // Fallback to pool callbacks if not provided
      onResult = onResult || this.onResult;
      onError = onError || this.onError;
    }

    if (this._tasks.size >= this.maxConcurrent) {
      return { taskId: null, accepted: false };
    }

    const taskId = this._nextId++;
    const startedAt = Date.now();
    const { handle, promise } = this.workerFactory(prompt, sessionId, ctx);
    const record = { id: taskId, prompt, ctx, replyToMessageId, startedAt, handle };
    this._tasks.set(taskId, record);

    promise.then(
      (result) => {
        this._tasks.delete(taskId);
        onResult?.(taskId, result);
      },
      (err) => {
        this._tasks.delete(taskId);
        onError?.(taskId, err);
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
