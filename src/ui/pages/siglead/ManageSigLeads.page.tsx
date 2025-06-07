import { Title, Button, Container, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { DateTimePicker } from "@mantine/dates";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { AuthGuard } from "@ui/components/AuthGuard";
import { getRunEnvironmentConfig } from "@ui/config";
import { useApi } from "@ui/util/api";
import { OrganizationList as orgList } from "@common/orgs";
import { AppRoles } from "@common/roles";
import { ScreenComponent } from "./SigScreenComponents";
import { transformSigLeadToURI } from "@common/utils";
import {
  SigDetailRecord,
  SigleadGetRequest,
  SigMemberCount,
  SigMemberRecord,
} from "@common/types/siglead";

export const ManageSigLeadsPage: React.FC = () => {
  const [SigMemberCounts, setSigMemberCounts] = useState<SigMemberCount[]>([]);
  const navigate = useNavigate();
  const api = useApi("core");

  useEffect(() => {
    const getMemberCounts = async () => {
      try {
        const sigMemberCountsRequest = await api.get(
          `/api/v1/siglead/sigcount`,
        );
        setSigMemberCounts(sigMemberCountsRequest.data);
      } catch (error) {
        console.error("Error fetching sig member counts:", error);
        notifications.show({
          message: "Failed to fetch sig member counts, please try again.",
        });
      }
    };
    getMemberCounts();
  }, []);

  return (
    <AuthGuard
      resourceDef={{ service: "core", validRoles: [AppRoles.IAM_ADMIN] }}
    >
      <Container>
        <Group flex="auto">
          <Title order={2}>SigLead Management System</Title>
          <Button
            ml="auto"
            variant="gradient"
            onClick={() => navigate("/siglead-management/edit")}
          >
            Add a Sig
          </Button>
        </Group>

        <ScreenComponent SigMemberCounts={SigMemberCounts} />
        {/* <SigTable /> */}
      </Container>
    </AuthGuard>
  );
};
