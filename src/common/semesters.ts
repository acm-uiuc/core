export type SemesterOption = { value: string; label: string };

const semester = (season: "sp" | "fa", year: number): SemesterOption => ({
  value: `${season}${year.toString().slice(-2)}`,
  label: `${season === "sp" ? "Spring" : "Fall"} ${year}`,
});

const now = () => {
  const d = new Date();
  return { y: d.getFullYear(), spring: d.getMonth() + 1 <= 5 };
};

export function getPreviousSemesters(): SemesterOption[] {
  const { y, spring } = now();
  return spring
    ? [semester("fa", y - 2), semester("sp", y - 1), semester("fa", y - 1)]
    : [semester("sp", y - 1), semester("fa", y - 1), semester("sp", y)];
}

export function getSemesters(): SemesterOption[] {
  const { y, spring } = now();
  return spring
    ? [semester("sp", y), semester("fa", y), semester("sp", y + 1)]
    : [semester("fa", y), semester("sp", y + 1), semester("fa", y + 1)];
}
