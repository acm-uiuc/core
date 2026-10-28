import React, { useEffect, useMemo } from "react";
import { Select, type SelectProps } from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import {
  getPreviousSemesters,
  getSemesters,
  type SemesterOption,
} from "@common/semesters";

/**
 * Keeps the selected semester in the URL (?semester=fa26) so the choice
 * survives refreshes and can be shared as a link. Defaults to the current
 * semester when the URL has no (or an unknown) semester.
 */
export function useSemesterSearchParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentAndUpcoming = useMemo(() => getSemesters(), []);
  const semesterOptions: SemesterOption[] = useMemo(
    () => [...getPreviousSemesters(), ...currentAndUpcoming],
    [currentAndUpcoming],
  );

  const fromUrl = searchParams.get("semester");
  const isValid = !!fromUrl && semesterOptions.some((x) => x.value === fromUrl);
  const semester = isValid ? fromUrl : currentAndUpcoming[0].value;

  const setSemester = (newSemester: string | null) => {
    if (newSemester && newSemester !== semester) {
      const currentParams = Object.fromEntries(searchParams.entries());
      setSearchParams({ ...currentParams, semester: newSemester });
    }
  };

  useEffect(() => {
    if (!isValid) {
      const currentParams = Object.fromEntries(searchParams.entries());
      setSearchParams({ ...currentParams, semester }, { replace: true });
    }
  }, [isValid, semester, searchParams, setSearchParams]);

  return { semester, setSemester, semesterOptions };
}

type SemesterSelectProps = {
  value: string;
  onChange: (semester: string | null) => void;
  options: SemesterOption[];
} & Omit<SelectProps, "value" | "onChange" | "data">;

export const SemesterSelect: React.FC<SemesterSelectProps> = ({
  value,
  onChange,
  options,
  ...rest
}) => (
  <Select
    label="Select Semester"
    searchable
    value={value}
    onChange={onChange}
    data={options}
    mt="sm"
    mb="sm"
    {...rest}
  />
);
