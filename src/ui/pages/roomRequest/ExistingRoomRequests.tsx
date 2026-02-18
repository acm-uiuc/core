import React, { useEffect, useState } from "react";
import {
  RoomRequestListResponse,
  formatStatus,
} from "@common/types/roomRequest";
import { Badge, Loader } from "@mantine/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getStatusColor } from "./roomRequestUtils";
import { Organizations } from "@acm-uiuc/js-shared";
import {
  ResponsiveTable,
  Column,
  useTableSort,
} from "@ui/components/ResponsiveTable";

type RoomRequestItem = RoomRequestListResponse[number];

interface ExistingRoomRequestsProps {
  getRoomRequests: (semester: string) => Promise<RoomRequestListResponse>;
  semester: string;
}
const ExistingRoomRequests: React.FC<ExistingRoomRequestsProps> = ({
  getRoomRequests,
  semester,
}) => {
  const [data, setData] = useState<RoomRequestListResponse | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onlySccs = searchParams.get("onlySccs") === "true";
  const { sortBy, reversedSort, handleSort, sortData } =
    useTableSort<RoomRequestItem>();

  useEffect(() => {
    const inner = async () => {
      setData(await getRoomRequests(semester));
    };
    inner();
  }, [semester]);

  const filteredData = data
    ? sortData(
        onlySccs ? data.filter((item) => item.requestsSccsRoom) : data,
        (a, b, key) => {
          const aVal =
            key === "host"
              ? Organizations[a.host].name
              : String(a[key as keyof RoomRequestItem] ?? "");
          const bVal =
            key === "host"
              ? Organizations[b.host].name
              : String(b[key as keyof RoomRequestItem] ?? "");
          return aVal.localeCompare(bVal);
        },
      )
    : null;

  const columns: Column<RoomRequestItem>[] = [
    {
      key: "title",
      label: "Name",
      isPrimaryColumn: true,
      render: (item) => item.title,
    },
    {
      key: "host",
      label: "Host",
      render: (item) => Organizations[item.host].name,
      sortable: true,
    },
    {
      key: "status",
      label: "Status",
      render: (item) => (
        <Badge color={getStatusColor(item.status)}>
          {formatStatus(item.status)}
        </Badge>
      ),
      sortable: true,
    },
  ];

  if (!filteredData) {
    return <Loader size={32} />;
  }

  return (
    <ResponsiveTable
      data={filteredData}
      columns={columns}
      keyExtractor={(item) => item.requestId}
      onRowClick={(item) =>
        navigate(`/roomRequests/${item.semester}/${item.requestId}`)
      }
      onSort={handleSort}
      sortBy={sortBy}
      sortReversed={reversedSort}
    />
  );
};

export default ExistingRoomRequests;
