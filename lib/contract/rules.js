export const RULES = new Map();

export function registerRule({ id, severity, layers, run }) {
  RULES.set(id, { id, severity, layers, run });
}
