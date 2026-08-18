import { appendFileSync } from "node:fs";
import { join } from "node:path";

import { EVENTS_DIR } from "../core/config.ts";
import type { ProviderInstance, RuntimeEvent, RuntimeEventListener } from "../core/contracts.ts";

export class EventBus {
  private subscribers = new Set<RuntimeEventListener>();
  private detachers: Array<() => void> = [];

  attach(instances: ProviderInstance[]) {
    for (const instance of instances) {
      const detach = instance.adapter.onEvent((event) => {
        if (event.provider !== instance.driverKind) {
          console.error(`bus: dropped cross-driver event from ${instance.instanceId}`);
          return;
        }
        this.publish({ ...event, providerInstanceId: instance.instanceId });
      });
      this.detachers.push(detach);
    }
  }

  publish(event: RuntimeEvent) {
    this.record(event);
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(event);
      } catch (error) {
        console.error("bus: listener threw", error);
      }
    }
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  detachAll() {
    for (const detach of this.detachers.splice(0)) detach();
  }

  private record(event: RuntimeEvent) {
    try {
      appendFileSync(join(EVENTS_DIR, `${event.threadId}.ndjson`), JSON.stringify(event) + "\n");
    } catch {
    }
  }
}
