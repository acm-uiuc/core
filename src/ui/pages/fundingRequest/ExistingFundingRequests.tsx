import React, { useEffect, useState } from "react";
import { Alert, Badge, Loader, Text } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { Organizations } from "@acm-uiuc/js-shared";
import {
  ResponsiveTable,
  Column,
  useTableSort,
} from "@ui/components/ResponsiveTable";
import {
  FundingRequestListItem,
  FundingRequestListResponse,
  FundingRequestStatus,
  formatCentsAsUsd,
  formatFundingRequestStatus,
  formatFundingRequestType,
} from "@common/types/fundingRequest";

export const getFundingRequestStatusColor = (status: FundingRequestStatus) => {
  switch (status) {
    case FundingRequestStatus.APPROVED:
      return "green";
    case FundingRequestStatus.PAID:
      return "teal";
    case FundingRequestStatus.DENIED:
      return "red";
    case FundingRequestStatus.NEEDS_UPDATE:
      return "yellow";
    case FundingRequestStatus.SUBMITTED:
      return "blue";
    default:
      return "gray";
  }
};

const orgName = (orgId: string) =>
  Organizations[orgId as keyof typeof Organizations]?.name ?? orgId;

interface ExistingFundingRequestsProps {
  getFundingRequests: (semester: string) => Promise<FundingRequestListResponse>;
  semester: string;
}

const ExistingFundingRequests: React.FC<ExistingFundingRequestsProps> = ({
  getFundingRequests,
  semester,
}) => {
  const [data, setData] = useState<FundingRequestListResponse | null>(null);
  const [error, setError] = useState(false);
  const { sortBy, reversedSort, handleSort, sortData } =
    useTableSort<FundingRequestListItem>();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    getFundingRequests(semester)
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [semester]);

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertCircle />} title="Error">
        Could not load funding requests. Please try again later.
      </Alert>
    );
  }

  if (!data) {
    return <Loader size={32} />;
  }

  if (data.length === 0) {
    return (
      <Text c="dimmed" mt="sm">
        No funding requests for this semester.
      </Text>
    );
  }

  const sortedData = sortData(data, (a, b, key) => {
    if (key === "requestedAmountCents") {
      return a.requestedAmountCents - b.requestedAmountCents;
    }
    const aVal =
      key === "orgId"
        ? orgName(a.orgId)
        : String(a[key as keyof FundingRequestListItem] ?? "");
    const bVal =
      key === "orgId"
        ? orgName(b.orgId)
        : String(b[key as keyof FundingRequestListItem] ?? "");
    return aVal.localeCompare(bVal);
  });

  const columns: Column<FundingRequestListItem>[] = [
    {
      key: "title",
      label: "Title",
      isPrimaryColumn: true,
      render: (item) => item.title,
    },
    {
      key: "orgId",
      label: "Organization",
      render: (item) => orgName(item.orgId),
      sortable: true,
    },
    {
      key: "type",
      label: "Type",
      render: (item) => formatFundingRequestType(item.type),
      sortable: true,
    },
    {
      key: "requestedAmountCents",
      label: "Amount Requested",
      render: (item) => formatCentsAsUsd(item.requestedAmountCents),
      sortable: true,
    },
    {
      key: "approvedAmountCents",
      label: "Amount Approved",
      render: (item) =>
        item.approvedAmountCents === undefined
          ? "—"
          : formatCentsAsUsd(item.approvedAmountCents),
    },
    {
      key: "status",
      label: "Status",
      render: (item) => (
        <Badge color={getFundingRequestStatusColor(item.status)}>
          {formatFundingRequestStatus(item.status)}
        </Badge>
      ),
      sortable: true,
    },
    {
      key: "createdAt",
      label: "Created",
      render: (item) => new Date(item.createdAt).toLocaleDateString("en-US"),
      sortable: true,
    },
  ];

  return (
    <ResponsiveTable
      data={sortedData}
      columns={columns}
      keyExtractor={(item) => item.requestId}
      onSort={handleSort}
      sortBy={sortBy}
      sortReversed={reversedSort}
    />
  );
};

export default ExistingFundingRequests;
