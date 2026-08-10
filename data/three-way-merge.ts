type JsonObject = Record<string, unknown>;

export interface ThreeWayMergeResult {
  merged: unknown | null;
  localCandidate: unknown;
  remoteCandidate: unknown;
  conflictPaths: string[];
}

const isObject = (value: unknown): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]));
}

const MISSING = Symbol('missing');

function mergeNode(base: unknown, local: unknown, remote: unknown, path: string): ThreeWayMergeResult {
  if (jsonValuesEqual(local, remote)) return { merged: local, localCandidate: local, remoteCandidate: local, conflictPaths: [] };
  if (jsonValuesEqual(local, base)) return { merged: remote, localCandidate: remote, remoteCandidate: remote, conflictPaths: [] };
  if (jsonValuesEqual(remote, base)) return { merged: local, localCandidate: local, remoteCandidate: local, conflictPaths: [] };

  if (isObject(base) && isObject(local) && isObject(remote)) {
    const merged: JsonObject = {};
    const localCandidate: JsonObject = {};
    const remoteCandidate: JsonObject = {};
    const conflictPaths: string[] = [];
    const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])].sort();
    for (const key of keys) {
      const baseValue = Object.hasOwn(base, key) ? base[key] : MISSING;
      const localValue = Object.hasOwn(local, key) ? local[key] : MISSING;
      const remoteValue = Object.hasOwn(remote, key) ? remote[key] : MISSING;
      const child = mergeNode(baseValue, localValue, remoteValue, path ? `${path}.${key}` : key);
      conflictPaths.push(...child.conflictPaths);
      if (!child.conflictPaths.length && child.merged !== MISSING) merged[key] = child.merged;
      if (child.localCandidate !== MISSING) localCandidate[key] = child.localCandidate;
      if (child.remoteCandidate !== MISSING) remoteCandidate[key] = child.remoteCandidate;
    }
    return {
      merged: conflictPaths.length ? null : merged,
      localCandidate,
      remoteCandidate,
      conflictPaths,
    };
  }

  return { merged: null, localCandidate: local, remoteCandidate: remote, conflictPaths: [path || '$'] };
}

export function threeWayMerge(base: unknown, local: unknown, remote: unknown): ThreeWayMergeResult {
  return mergeNode(base, local, remote, '');
}

export function mergeJsonPayloads(basePayload: string, localPayload: string, remotePayload: string): ThreeWayMergeResult | null {
  try {
    return threeWayMerge(JSON.parse(basePayload), JSON.parse(localPayload), JSON.parse(remotePayload));
  } catch {
    return null;
  }
}
