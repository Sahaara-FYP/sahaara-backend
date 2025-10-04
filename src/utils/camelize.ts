export function toCamel(str: string) {
  return str.replace(/([-_][a-z])/gi, (s) =>
    s.toUpperCase().replace(/[-_]/g, "")
  );
}

export function keysToCamel<T>(obj: any): T {
  if (Array.isArray(obj)) {
    return obj.map((v) => keysToCamel(v)) as T;
  } else if (obj !== null && obj.constructor === Object) {
    return Object.entries(obj).reduce((acc: any, [key, value]) => {
      acc[toCamel(key)] = keysToCamel(value);
      return acc;
    }, {});
  }
  return obj;
}
