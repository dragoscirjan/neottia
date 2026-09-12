/** Clones and freezes JSON-like configuration without retaining caller-owned references. */
export function cloneAndFreezeConfigValue<Value>(value: Value): Value {
  return cloneValue(value, new WeakSet<object>()) as Value;
}

/** Recursively clones supported configuration values and rejects mutable class instances. */
function cloneValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || value === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('configuration values must contain only data');
  }
  if (ancestors.has(value)) {
    throw new TypeError('configuration values must not contain cycles');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item) => cloneValue(item, ancestors)));
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('configuration values must contain only plain objects and arrays');
    }

    const clone: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new TypeError('configuration object keys must be strings');
      }
      Object.defineProperty(clone, key, {
        configurable: false,
        enumerable: true,
        value: cloneValue((value as Record<string, unknown>)[key], ancestors),
        writable: false,
      });
    }
    return Object.freeze(clone);
  } finally {
    ancestors.delete(value);
  }
}
