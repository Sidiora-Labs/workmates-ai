interface Filed {
  section?: string | null;
}

export function sectionNames(...groups: Filed[][]): string[] {
  const names = new Set<string>();
  for (const rows of groups) {
    for (const row of rows) if (row.section) names.add(row.section);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function inSection<T extends Filed>(rows: T[], name: string | null): T[] {
  return rows.filter((row) => (row.section ?? null) === name);
}
