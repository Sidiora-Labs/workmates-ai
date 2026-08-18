import type {
  AnyProviderDriver,
  InstanceConfigMap,
  InstanceId,
  ProviderInstance,
  ProviderSnapshot,
} from "../core/contracts.ts";

export interface ShadowInstance {
  instanceId: InstanceId;
  driverKind: string;
  displayName: string | undefined;
  shadow: true;
  reason: string;
}

export type RegistryEntry =
  | { instanceId: InstanceId; live: ProviderInstance; shadow?: undefined }
  | { instanceId: InstanceId; live?: undefined; shadow: ShadowInstance };

interface InstanceReport {
  instanceId: InstanceId;
  driverKind: string;
  displayName: string;
  snapshot: ProviderSnapshot;
  models: { default: string; options: Array<{ id: string; label: string }> };
}

export class ProviderRegistry {
  private entries_ = new Map<InstanceId, RegistryEntry>();
  private drivers: Map<string, AnyProviderDriver>;

  constructor(drivers: readonly AnyProviderDriver[]) {
    this.drivers = new Map(drivers.map((driver) => [driver.driverKind, driver]));
  }

  async load(configs: InstanceConfigMap) {
    for (const [instanceId, entry] of Object.entries(configs)) {
      const driver = this.drivers.get(entry.driver);

      if (!driver) {
        this.shadow(instanceId, entry.driver, entry.displayName, {
          reason: `unknown driver "${entry.driver}", kept as configured, unavailable here`,
        });
        continue;
      }

      try {
        const config =
          entry.config === undefined ? driver.defaultConfig() : driver.decodeConfig(entry.config);

        this.entries_.set(instanceId, {
          instanceId,
          live: await driver.create({
            instanceId,
            displayName: entry.displayName ?? driver.metadata.displayName,
            environment: entry.environment ?? {},
            enabled: entry.enabled ?? true,
            config,
          }),
        });
      } catch (error) {
        this.shadow(instanceId, entry.driver, entry.displayName ?? driver.metadata.displayName, {
          reason: describe(error),
        });
      }
    }
  }

  get(instanceId: InstanceId): ProviderInstance | null {
    return this.entries_.get(instanceId)?.live ?? null;
  }

  entries(): RegistryEntry[] {
    return [...this.entries_.values()];
  }

  instances(): ProviderInstance[] {
    return this.entries().flatMap((entry) => (entry.live ? [entry.live] : []));
  }

  describe(): Promise<InstanceReport[]> {
    return Promise.all(this.entries().map((entry) => report(entry)));
  }

  async disposeAll() {
    await Promise.allSettled(this.instances().map((instance) => instance.dispose()));
    this.entries_.clear();
  }

  private shadow(
    instanceId: InstanceId,
    driverKind: string,
    displayName: string | undefined,
    { reason }: { reason: string },
  ) {
    this.entries_.set(instanceId, {
      instanceId,
      shadow: { instanceId, driverKind, displayName, shadow: true, reason },
    });
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function report(entry: RegistryEntry): Promise<InstanceReport> {
  if (entry.shadow) {
    return {
      instanceId: entry.instanceId,
      driverKind: entry.shadow.driverKind,
      displayName: entry.shadow.displayName ?? entry.shadow.driverKind,
      snapshot: { state: "unavailable", reason: entry.shadow.reason },
      models: { default: "", options: [] },
    };
  }

  const instance = entry.live;
  let snapshot: ProviderSnapshot;
  try {
    snapshot = await instance.snapshot();
  } catch (error) {
    snapshot = { state: "unavailable", reason: describe(error) };
  }

  return {
    instanceId: instance.instanceId,
    driverKind: instance.driverKind,
    displayName: instance.displayName ?? instance.driverKind,
    snapshot,
    models: instance.models,
  };
}
