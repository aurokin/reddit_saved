import { OFFLINE_QUEUE_MAX_SIZE } from "../constants";
import type { RequestParams } from "../types";

export type RequestPriority = "high" | "normal" | "low";

interface QueueEntry {
  params: RequestParams;
  addedAt: number;
  priority: RequestPriority;
}

const PRIORITY_ORDER: Record<RequestPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * Buffers requests made while offline. Drains in priority order when back online.
 */
export class OfflineQueue {
  private queue: QueueEntry[] = [];
  private maxSize: number;

  constructor(maxSize = OFFLINE_QUEUE_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /** Returns false if queue is full and no lower-priority item could be evicted.
   *  Low-priority items do not evict other lows — prevents unbounded churn. */
  add(params: RequestParams, priority: RequestPriority = "normal"): boolean {
    if (this.queue.length >= this.maxSize) {
      // Only evict a low-priority entry if the incoming item is higher priority
      if (priority === "low") return false;
      const lowIdx = this.queue.findIndex((r) => r.priority === "low");
      if (lowIdx >= 0) {
        this.queue.splice(lowIdx, 1);
      } else {
        return false;
      }
    }

    this.queue.push({ params, addedAt: Date.now(), priority });
    return true;
  }

  /** Remove and return all queued requests with their priorities, sorted by priority */
  drain(): Array<{ params: RequestParams; priority: RequestPriority }> {
    const sorted = [...this.queue].sort(
      (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    );
    this.queue = [];
    return sorted.map((r) => ({ params: r.params, priority: r.priority }));
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}
