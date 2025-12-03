import {
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Group,
  NumberFormatter,
  Skeleton,
  Title,
  Text,
  Stack,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { GetInvoiceLinksResponse } from "@common/types/stripe";
import { notifications } from "@mantine/notifications";
import pluralize from "pluralize";
import dayjs from "dayjs";
import { STRIPE_LINK_RETENTION_DAYS } from "@common/constants";
import { ResponsiveTable, Column } from "@ui/components/ResponsiveTable";
import { NameOptionalUserCard } from "@ui/components/NameOptionalCard";

const HumanFriendlyDate = ({ date }: { date: string | Date }) => {
  return <Text size="sm">{dayjs(date).format("MMMM D, YYYY")}</Text>;
};

interface StripeCurrentLinksPanelProps {
  getLinks: () => Promise<GetInvoiceLinksResponse>;
  deactivateLink: (linkId: string) => Promise<void>;
}

type LinkData = GetInvoiceLinksResponse[number] & {
  isSelected: boolean;
};

export const StripeCurrentLinksPanel: React.FC<
  StripeCurrentLinksPanelProps
> = ({ getLinks, deactivateLink }) => {
  const [links, setLinks] = useState<GetInvoiceLinksResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedRows, setSelectedRows] = useState<
    { id: string; active: boolean }[]
  >([]);

  const deleteLinks = async (linkIds: string[]) => {
    const promises = linkIds.map((x) => deactivateLink(x));
    const results = await Promise.allSettled(promises);
    let success = 0;
    let fail = 0;
    for (const item of results) {
      if (item.status === "rejected") {
        fail++;
      } else {
        success++;
      }
    }
    return { fail, success };
  };

  const getLinksOnLoad = async () => {
    try {
      setIsLoading(true);
      const data = await getLinks();
      setLinks(data);
      setIsLoading(false);
    } catch (e) {
      setIsLoading(false);
      notifications.show({
        title: "Error",
        message:
          "Failed to get payment links. Please try again or contact support.",
        color: "red",
        icon: <IconAlertCircle size={16} />,
      });
      console.error(e);
    }
  };

  useEffect(() => {
    getLinksOnLoad();
  }, []);

  const deactivateLinks = async (linkIds: string[]) => {
    setIsLoading(true);
    try {
      const result = await deleteLinks(linkIds);
      if (result.fail > 0) {
        notifications.show({
          title: `Failed to deactivate ${pluralize("link", result.fail, true)}.`,
          message: "Please try again later.",
          color: "red",
        });
      }
      if (result.success > 0) {
        notifications.show({
          title: `Deactivated ${pluralize("link", result.success, true)}!`,
          message: `Links will be permanently removed from this page after ${STRIPE_LINK_RETENTION_DAYS} days.`,
          color: "green",
        });
      }
      getLinksOnLoad();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRow = (
    linkId: string,
    active: boolean,
    checked: boolean,
  ) => {
    setSelectedRows(
      checked
        ? [...selectedRows, { id: linkId, active }]
        : selectedRows.filter(({ id }) => id !== linkId),
    );
  };

  const handleSelectAll = () => {
    if (!links) {
      return;
    }
    if (selectedRows.length >= links.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(links.map((x) => ({ id: x.id, active: x.active })));
    }
  };

  const displayLinks: LinkData[] = links
    ? links.map((link) => ({
        ...link,
        isSelected: selectedRows.map((x) => x.id).includes(link.id),
      }))
    : [];

  // Define columns for links table
  const linksColumns: Column<LinkData>[] = [
    {
      key: "select",
      label: "Select",
      hideMobileLabel: true,
      render: (link) => (
        <Checkbox
          aria-label="Select row"
          checked={link.isSelected}
          onChange={(event) =>
            handleSelectRow(link.id, link.active, event.currentTarget.checked)
          }
        />
      ),
    },
    {
      key: "invoiceId",
      label: "Invoice ID",
      isPrimaryColumn: true,
      render: (link) => link.invoiceId,
    },
    {
      key: "status",
      label: "Status",
      render: (link) =>
        link.active ? (
          <Badge color="green" variant="light">
            Active
          </Badge>
        ) : (
          <Badge color="red" variant="light">
            Inactive
          </Badge>
        ),
    },
    {
      key: "amount",
      label: "Amount",
      render: (link) => (
        <NumberFormatter
          prefix="$"
          value={link.invoiceAmountUsd / 100}
          thousandSeparator
        />
      ),
    },
    {
      key: "createdBy",
      label: "Created By",
      render: (link) => <NameOptionalUserCard email={link.userId} />,
    },
    {
      key: "createdAt",
      label: "Created At",
      render: (link) =>
        link.createdAt === null ? (
          "Unknown"
        ) : (
          <HumanFriendlyDate date={link.createdAt} />
        ),
    },
    {
      key: "link",
      label: "Payment Link",
      hideMobileLabel: true,
      render: (link) => (
        <CopyButton value={link.link}>
          {({ copied, copy }) => (
            <Button
              color={copied ? "teal" : "blue"}
              onClick={(e) => {
                e.stopPropagation();
                copy();
              }}
              size="xs"
            >
              {copied ? "Copied!" : "Copy Link"}
            </Button>
          )}
        </CopyButton>
      ),
    },
  ];

  const skeletonRows = Array.from({ length: 3 }).map((_, index) => (
    <Skeleton key={`skeleton-${index}`} height={60} radius="sm" mb="sm" />
  ));

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Current Links</Title>
        <Group gap="sm">
          <Button
            variant="light"
            onClick={handleSelectAll}
            disabled={isLoading || !links || links.length === 0}
          >
            {selectedRows.length >= (links?.length || 0)
              ? "Deselect All"
              : "Select All"}
          </Button>
          {selectedRows.filter((x) => x.active).length > 0 && (
            <Button
              color="red"
              onClick={() => {
                deactivateLinks(
                  selectedRows.filter((x) => x.active).map((x) => x.id),
                );
              }}
            >
              Deactivate {selectedRows.filter((x) => x.active).length}{" "}
              {selectedRows.filter((x) => x.active).length !==
                selectedRows.length && "active"}{" "}
              {pluralize(
                "link",
                selectedRows.filter((x) => x.active).length,
                false,
              )}
            </Button>
          )}
        </Group>
      </Group>

      {isLoading || !links ? (
        <Stack gap="sm">{skeletonRows}</Stack>
      ) : links.length > 0 ? (
        <ResponsiveTable
          data={displayLinks}
          columns={linksColumns}
          keyExtractor={(link) => link.id}
          testIdPrefix="link-row"
          cardColumns={{ base: 1, sm: 2 }}
        />
      ) : (
        <Text c="dimmed" size="sm" ta="center" py="xl">
          No payment links found.
        </Text>
      )}
    </Stack>
  );
};

export default StripeCurrentLinksPanel;
