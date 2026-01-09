import React, { useEffect, useState } from "react";
import {
  RoomRequestGetAllResponse,
  formatStatus,
} from "@common/types/roomRequest";
import { Badge, Loader, Table } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { getStatusColor } from "./roomRequestUtils";
import { Organizations } from "@acm-uiuc/js-shared";

interface ExistingRoomRequestsProps {
  getRoomRequests: (semester: string) => Promise<RoomRequestGetAllResponse>;
  semester: string;
}
const ExistingRoomRequests: React.FC<ExistingRoomRequestsProps> = ({
  getRoomRequests,
  semester,
}) => {
  const [data, setData] = useState<RoomRequestGetAllResponse | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const inner = async () => {
      setData(await getRoomRequests(semester));
    };
    inner();
  }, [semester]);
  return (
    <>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Host</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        {!data && <Loader size={32} />}
        {data && (
          <Table.Tbody>
            {data.map((item) => {
              return (
                <Table.Tr key={item.requestId}>
                  <Table.Td
                    onClick={() =>
                      navigate(
                        `/roomRequests/${item.semester}/${item.requestId}`,
                      )
                    }
                    style={{
                      cursor: "pointer",
                      color: "var(--mantine-color-blue-6)",
                    }}
                  >
                    {item.title}
                  </Table.Td>
                  <Table.Td>{Organizations[item.host].name}</Table.Td>
                  <Table.Td>
                    <Badge color={getStatusColor(item.status)}>
                      {formatStatus(item.status)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        )}
      </Table>
    </>
  );
};

export default ExistingRoomRequests;
