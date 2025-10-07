import {
  Table,
  Card,
  Text,
  SimpleGrid,
  Stack,
  UnstyledButton,
  Center,
  Box,
  type MantineSpacing,
} from "@mantine/core";
import {
  IconChevronUp,
  IconChevronDown,
  IconSelector,
} from "@tabler/icons-react";
import React, { useState } from "react";

// Types
export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render: (item: T) => React.ReactNode;
  mobileLabel?: string; // Optional different label for mobile
  hideMobileLabel?: boolean; // Hide label in mobile card view
  mobileLabelStyle?: React.CSSProperties; // Custom styles for mobile label
  cardColumn?: number; // Which column this field should appear in (1 or 2), defaults to auto-flow
  isPrimaryColumn?: boolean; // Bold and emphasize this column in mobile cards
}

export interface ResponsiveTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string;
  onSort?: (key: string) => void;
  sortBy?: string | null;
  sortReversed?: boolean;
  testIdPrefix?: string;
  onRowClick?: (item: T) => void;
  mobileBreakpoint?: number; // px value, defaults to 768
  mobileLabelStyle?: React.CSSProperties; // Default style for all mobile labels
  padding?: MantineSpacing;
  mobileColumns?:
    | number
    | { base?: number; xs?: number; sm?: number; md?: number }; // Grid columns for mobile cards
  cardColumns?: number | { base?: number; xs?: number; sm?: number }; // Columns inside each card
}

interface ThProps {
  children: React.ReactNode;
  reversed: boolean;
  sorted: boolean;
  onSort: () => void;
}

function Th({ children, reversed, sorted, onSort }: ThProps) {
  const Icon = sorted
    ? reversed
      ? IconChevronUp
      : IconChevronDown
    : IconSelector;

  return (
    <Table.Th>
      <UnstyledButton
        onClick={onSort}
        style={{ display: "flex", alignItems: "center", gap: "4px" }}
      >
        <Text fw={500} size="sm">
          {children}
        </Text>
        <Center>
          <Icon size={14} stroke={1.5} />
        </Center>
      </UnstyledButton>
    </Table.Th>
  );
}

export function ResponsiveTable<T>({
  data,
  columns,
  keyExtractor,
  onSort,
  sortBy = null,
  sortReversed = false,
  testIdPrefix,
  onRowClick,
  mobileBreakpoint = 768,
  mobileLabelStyle = {
    fontSize: "0.875rem",
    color: "#868e96",
    fontWeight: 600,
    marginBottom: "4px",
  },
  padding,
  mobileColumns = { base: 1, sm: 2 },
  cardColumns = { base: 1, xs: 2 },
}: ResponsiveTableProps<T>) {
  const realPadding = padding || "sm";
  const [isMobile, setIsMobile] = useState(
    window.innerWidth < mobileBreakpoint,
  );

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [mobileBreakpoint]);

  const handleSort = (key: string) => {
    if (onSort) {
      onSort(key);
    }
  };

  // Desktop table view
  if (!isMobile) {
    return (
      <Table>
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => {
              if (column.sortable && onSort) {
                return (
                  <Th
                    key={column.key}
                    sorted={sortBy === column.key}
                    reversed={sortReversed}
                    onSort={() => handleSort(column.key)}
                  >
                    {column.label}
                  </Th>
                );
              }
              return (
                <Table.Th key={column.key}>
                  <Text fw={500} size="sm">
                    {column.label}
                  </Text>
                </Table.Th>
              );
            })}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.map((item) => {
            const key = keyExtractor(item);
            return (
              <Table.Tr
                key={key}
                style={onRowClick ? { cursor: "pointer" } : undefined}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
                data-testid={
                  testIdPrefix ? `${testIdPrefix}-${key}` : undefined
                }
              >
                {columns.map((column) => (
                  <Table.Td key={`${key}-${column.key}`}>
                    {column.render(item)}
                  </Table.Td>
                ))}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    );
  }

  // Mobile card view with responsive grid
  return (
    <SimpleGrid cols={mobileColumns} spacing={realPadding} pt="sm">
      {data.map((item) => {
        const key = keyExtractor(item);
        return (
          <Card
            key={key}
            withBorder
            padding={realPadding}
            style={onRowClick ? { cursor: "pointer" } : undefined}
            onClick={onRowClick ? () => onRowClick(item) : undefined}
            data-testid={testIdPrefix ? `${testIdPrefix}-${key}` : undefined}
          >
            <SimpleGrid cols={cardColumns} spacing="sm">
              {columns.map((column) => {
                const mobileLabel = column.mobileLabel || column.label;
                const showLabel = !column.hideMobileLabel;
                const labelStyle = column.mobileLabelStyle || mobileLabelStyle;
                const isPrimary = column.isPrimaryColumn;

                return (
                  <Box key={`${key}-${column.key}`}>
                    {showLabel && (
                      <Text
                        style={
                          isPrimary
                            ? {
                                ...labelStyle,
                                fontWeight: 700,
                                color: "#000",
                              }
                            : labelStyle
                        }
                      >
                        {mobileLabel}
                      </Text>
                    )}
                    <Box
                      style={
                        isPrimary
                          ? {
                              fontSize: "1rem",
                              fontWeight: 600,
                            }
                          : {
                              fontSize: "0.875rem",
                              fontWeight: 400,
                            }
                      }
                    >
                      {column.render(item)}
                    </Box>
                  </Box>
                );
              })}
            </SimpleGrid>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}

// Hook for sorting logic
export function useTableSort<T>(initialSortBy: string | null = null): {
  sortBy: string | null;
  reversedSort: boolean;
  handleSort: (field: string) => void;
  sortData: (data: T[], sortFn: (a: T, b: T, sortBy: string) => number) => T[];
} {
  const [sortBy, setSortBy] = useState<string | null>(initialSortBy);
  const [reversedSort, setReversedSort] = useState(false);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setReversedSort((r) => !r);
    } else {
      setSortBy(field);
      setReversedSort(false);
    }
  };

  const sortData = (
    data: T[],
    sortFn: (a: T, b: T, sortBy: string) => number,
  ): T[] => {
    if (!sortBy) {
      return data;
    }

    return [...data].sort((a, b) => {
      const comparison = sortFn(a, b, sortBy);
      return reversedSort ? -comparison : comparison;
    });
  };

  return { sortBy, reversedSort, handleSort, sortData };
}
