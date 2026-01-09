// Format a title using Jest-like specifiers and $key for object rows
export default function formatTitle(template: string, row: any, index: number): string {
  if (typeof template !== "string") return String(template);

  // Array rows: positional specifiers
  if (Array.isArray(row)) {
    let argIndex = 0;
    return template.replace(/%(%|p|s|d|i|f|j|o|#)/g, (_match, code: string) => {
      if (code === "%") return "%";
      if (code === "#") return String(index);

      const arg = row[argIndex++];

      switch (code) {
        case "p": {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        case "s":
        case "d":
        case "i":
        case "f": {
          return String(arg);
        }
        case "j":
        case "o": {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        default:
          return String(arg);
      }
    });
  }

  // Object rows: $key substitutions
  if (row && typeof row === "object") {
    return template.replace(/\$([a-zA-Z0-9_]+)/g, (_m, key: string) => {
      const val = row[key];
      if (val === undefined) return `$${key}`;
      try {
        // Strings inline, others JSON
        return typeof val === "string" ? val : JSON.stringify(val);
      } catch {
        return String(val);
      }
    });
  }

  // Single value
  return template.replace(/%p|%s|%d|%i|%f|%j|%o|%#/g, () => String(row));
}
