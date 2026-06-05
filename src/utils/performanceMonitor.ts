/**
 * Performance Monitor — Task 9.3
 * Tracks page load time, skill response time, and memory usage.
 * Reports warnings when thresholds are exceeded.
 */

// --- Thresholds ---
const THRESHOLDS = {
  pageLoad: 1500,     // ms — page load < 1.5s
  skillResponse: 2000, // ms — skill response < 2s
  memory: 200,        // MB — memory < 200MB
};

// --- Metric Store ---
interface PerfMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
  timestamp: number;
  exceeded: boolean;
}

const metrics: PerfMetric[] = [];

function record(name: string, value: number, unit: string, threshold?: number): PerfMetric {
  const exceeded = threshold !== undefined && value > threshold;
  const metric: PerfMetric = { name, value, unit, threshold, timestamp: Date.now(), exceeded };
  metrics.push(metric);
  if (exceeded) {
    console.warn(
      `[Perf] ⚠ ${name}: ${value.toFixed(1)}${unit} exceeds threshold ${threshold}${unit}`
    );
  } else {
    console.info(`[Perf] ✓ ${name}: ${value.toFixed(1)}${unit}`);
  }
  return metric;
}

// --- Page Load Time ---
export function measurePageLoad(): void {
  if (typeof window === 'undefined') return;
  // Use Navigation Timing API
  const onLoad = () => {
    try {
      const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (entry) {
        const loadTime = entry.loadEventEnd - entry.startTime;
        record('Page Load', loadTime, 'ms', THRESHOLDS.pageLoad);
      } else {
        // Fallback: measure from performance.now()
        record('Page Load (approx)', performance.now(), 'ms', THRESHOLDS.pageLoad);
      }
    } catch {
      // Performance API not available
    }
  };

  if (document.readyState === 'complete') {
    // Already loaded — measure after a tick
    setTimeout(onLoad, 0);
  } else {
    window.addEventListener('load', onLoad, { once: true });
  }
}

// --- Skill Response Timer ---
export function startSkillTimer(skillId: string): () => void {
  const start = performance.now();
  return () => {
    const elapsed = performance.now() - start;
    record(`Skill Response [${skillId}]`, elapsed, 'ms', THRESHOLDS.skillResponse);
  };
}

// --- Memory Usage ---
export function measureMemory(): void {
  try {
    // Chrome-only: performance.memory
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) {
      const usedMB = mem.usedJSHeapSize / 1024 / 1024;
      record('JS Heap', usedMB, 'MB', THRESHOLDS.memory);
    }
  } catch {
    // Not available
  }
}

// --- First Contentful Paint ---
export function measureFCP(): void {
  if (typeof window === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          record('FCP', entry.startTime, 'ms', 1000);
          observer.disconnect();
        }
      }
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // PerformanceObserver not available
  }
}

// --- Get All Metrics ---
export function getMetrics(): PerfMetric[] {
  return [...metrics];
}

export function getExceededMetrics(): PerfMetric[] {
  return metrics.filter((m) => m.exceeded);
}

// --- Initialize All Monitors ---
export function initPerformanceMonitor(): void {
  measurePageLoad();
  measureFCP();
  // Measure memory after 5s (after initial load settles)
  setTimeout(measureMemory, 5000);
  // Periodic memory check every 60s
  setInterval(measureMemory, 60000);
}
