import http from 'http';

/**
 * Simple in-memory metrics collector with Prometheus endpoint
 */
export class MetricsCollector {
  constructor(port = 9090, logger) {
    this.port = port;
    this.logger = logger;
    this.server = null;

    // Metrics storage
    this.metrics = {
      requestsTotal: new Map(), // botId → count
      responseTimeMs: new Map(), // botId → [times]
      errorsTotal: new Map(), // botId → count
      queueDepth: new Map(), // botId → depth
      activeWorkers: 0,
      startTime: Date.now()
    };
  }

  /**
   * Record a successful request
   * @param {string} botId - Bot identifier
   * @param {number} durationMs - Request duration in milliseconds
   */
  recordRequest(botId, durationMs) {
    // Increment request count
    const current = this.metrics.requestsTotal.get(botId) || 0;
    this.metrics.requestsTotal.set(botId, current + 1);

    // Store response time (keep last 100)
    if (!this.metrics.responseTimeMs.has(botId)) {
      this.metrics.responseTimeMs.set(botId, []);
    }
    const times = this.metrics.responseTimeMs.get(botId);
    times.push(durationMs);
    if (times.length > 100) {
      times.shift();
    }
  }

  /**
   * Record an error
   * @param {string} botId - Bot identifier
   */
  recordError(botId) {
    const current = this.metrics.errorsTotal.get(botId) || 0;
    this.metrics.errorsTotal.set(botId, current + 1);
  }

  /**
   * Update queue depth for a bot
   * @param {string} botId - Bot identifier
   * @param {number} depth - Queue size
   */
  updateQueueDepth(botId, depth) {
    this.metrics.queueDepth.set(botId, depth);
  }

  /**
   * Update active worker count
   * @param {number} count - Active worker count
   */
  updateActiveWorkers(count) {
    this.metrics.activeWorkers = count;
  }

  /**
   * Get statistics for a bot
   * @param {string} botId - Bot identifier (optional)
   * @returns {Object}
   */
  getStats(botId = null) {
    if (botId) {
      const times = this.metrics.responseTimeMs.get(botId) || [];
      const avgResponseTime = times.length > 0
        ? times.reduce((a, b) => a + b, 0) / times.length
        : 0;

      return {
        requestsTotal: this.metrics.requestsTotal.get(botId) || 0,
        errorsTotal: this.metrics.errorsTotal.get(botId) || 0,
        queueDepth: this.metrics.queueDepth.get(botId) || 0,
        avgResponseTimeMs: Math.round(avgResponseTime),
        recentResponseTimes: times.slice(-10)
      };
    }

    // Global stats
    let totalRequests = 0;
    let totalErrors = 0;
    let totalQueueDepth = 0;

    for (const count of this.metrics.requestsTotal.values()) {
      totalRequests += count;
    }
    for (const count of this.metrics.errorsTotal.values()) {
      totalErrors += count;
    }
    for (const depth of this.metrics.queueDepth.values()) {
      totalQueueDepth += depth;
    }

    return {
      totalRequests,
      totalErrors,
      totalQueueDepth,
      activeWorkers: this.metrics.activeWorkers,
      botCount: this.metrics.requestsTotal.size,
      uptimeSeconds: Math.floor((Date.now() - this.metrics.startTime) / 1000)
    };
  }

  /**
   * Start metrics HTTP server
   */
  async start() {
    if (this.server) {
      this.logger.warn('Metrics server already running');
      return;
    }

    this.server = http.createServer((req, res) => {
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(this.#generatePrometheusMetrics());
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          uptime: Date.now() - this.metrics.startTime,
          stats: this.getStats()
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info({ port: this.port }, 'Metrics server started');
    });
  }

  /**
   * Generate Prometheus-format metrics
   * @private
   */
  #generatePrometheusMetrics() {
    const lines = [];

    // Requests total
    lines.push('# HELP circus_requests_total Total number of requests processed');
    lines.push('# TYPE circus_requests_total counter');
    for (const [botId, count] of this.metrics.requestsTotal.entries()) {
      lines.push(`circus_requests_total{bot_id="${botId}"} ${count}`);
    }

    // Errors total
    lines.push('# HELP circus_errors_total Total number of errors');
    lines.push('# TYPE circus_errors_total counter');
    for (const [botId, count] of this.metrics.errorsTotal.entries()) {
      lines.push(`circus_errors_total{bot_id="${botId}"} ${count}`);
    }

    // Queue depth
    lines.push('# HELP circus_queue_depth Current queue depth per bot');
    lines.push('# TYPE circus_queue_depth gauge');
    for (const [botId, depth] of this.metrics.queueDepth.entries()) {
      lines.push(`circus_queue_depth{bot_id="${botId}"} ${depth}`);
    }

    // Active workers
    lines.push('# HELP circus_active_workers Current number of active workers');
    lines.push('# TYPE circus_active_workers gauge');
    lines.push(`circus_active_workers ${this.metrics.activeWorkers}`);

    // Uptime
    lines.push('# HELP circus_uptime_seconds Orchestrator uptime in seconds');
    lines.push('# TYPE circus_uptime_seconds counter');
    const uptimeSeconds = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    lines.push(`circus_uptime_seconds ${uptimeSeconds}`);

    // Response times (average per bot)
    lines.push('# HELP circus_response_time_ms Average response time in milliseconds');
    lines.push('# TYPE circus_response_time_ms gauge');
    for (const [botId, times] of this.metrics.responseTimeMs.entries()) {
      if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        lines.push(`circus_response_time_ms{bot_id="${botId}"} ${avg.toFixed(2)}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Stop metrics server
   */
  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('Metrics server stopped');
          this.server = null;
          resolve();
        });
      });
    }
  }
}
