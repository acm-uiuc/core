export type SemesterOption = { value: string; label: string };

export function getPreviousSemesters() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const semesters: { value: string; label: string }[] = [];
  let currentSemester = "";

  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "Spring";
  } else if (currentMonth >= 6 && currentMonth <= 12) {
    currentSemester = "Fall";
  }

  if (currentSemester === "Spring") {
    semesters.push({
      value: `fa${(currentYear - 1).toString().slice(-2)}`,
      label: `Fall ${currentYear - 1}`,
    });
    semesters.push({
      value: `sp${(currentYear - 1).toString().slice(-2)}`,
      label: `Spring ${currentYear - 1}`,
    });
    semesters.push({
      value: `fa${(currentYear - 2).toString().slice(-2)}`,
      label: `Fall ${currentYear - 2}`,
    });
  } else if (currentSemester === "Fall") {
    semesters.push({
      value: `sp${currentYear.toString().slice(-2)}`,
      label: `Spring ${currentYear}`,
    });
    semesters.push({
      value: `fa${(currentYear - 1).toString().slice(-2)}`,
      label: `Fall ${currentYear - 1}`,
    });
    semesters.push({
      value: `sp${(currentYear - 1).toString().slice(-2)}`,
      label: `Spring ${currentYear - 1}`,
    });
  }

  return semesters.reverse();
}

export function getSemesters() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const semesters: { value: string; label: string }[] = [];
  let currentSemester = "";

  if (currentMonth >= 1 && currentMonth <= 5) {
    currentSemester = "Spring";
  } else if (currentMonth >= 6 && currentMonth <= 12) {
    currentSemester = "Fall";
  }

  if (currentSemester === "Spring") {
    semesters.push({
      value: `sp${currentYear.toString().slice(-2)}`,
      label: `Spring ${currentYear}`,
    });
    semesters.push({
      value: `fa${currentYear.toString().slice(-2)}`,
      label: `Fall ${currentYear}`,
    });
    semesters.push({
      value: `sp${(currentYear + 1).toString().slice(-2)}`,
      label: `Spring ${currentYear + 1}`,
    });
  } else if (currentSemester === "Fall") {
    semesters.push({
      value: `fa${currentYear.toString().slice(-2)}`,
      label: `Fall ${currentYear}`,
    });
    semesters.push({
      value: `sp${(currentYear + 1).toString().slice(-2)}`,
      label: `Spring ${currentYear + 1}`,
    });
    semesters.push({
      value: `fa${(currentYear + 1).toString().slice(-2)}`,
      label: `Fall ${currentYear + 1}`,
    });
  }

  return semesters;
}
