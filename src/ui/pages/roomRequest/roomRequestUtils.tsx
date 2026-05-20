import { RoomRequestStatus } from "@common/types/roomRequest";
import { capitalizeFirstLetter } from "../events/ManageEvent.page";
import {
  IconCircleCheck,
  IconCircleDashedCheck,
  IconExclamationCircle,
  IconPencil,
  IconProgressCheck,
  IconQuestionMark,
} from "@tabler/icons-react";

export const getStatusIcon = (status: RoomRequestStatus) => {
  const commonProps = { size: 14 };
  switch (status) {
    case RoomRequestStatus.APPROVED:
      return <IconCircleCheck {...commonProps} />;
    case RoomRequestStatus.REJECTED_BY_UIUC:
    case RoomRequestStatus.REJECTED_BY_ACM:
      return <IconExclamationCircle {...commonProps} />;
    case RoomRequestStatus.SUBMITTED:
      return <IconProgressCheck {...commonProps} />;
    case RoomRequestStatus.MORE_INFORMATION_NEEDED:
      return <IconQuestionMark {...commonProps} />;
    case RoomRequestStatus.EDITED:
      return <IconPencil {...commonProps} />;
    default:
      return <IconCircleDashedCheck {...commonProps} />;
  }
};

export const getStatusColor = (status: RoomRequestStatus) => {
  switch (status) {
    case RoomRequestStatus.APPROVED:
      return "green";
    case RoomRequestStatus.REJECTED_BY_UIUC:
    case RoomRequestStatus.REJECTED_BY_ACM:
      return "red";
    case RoomRequestStatus.SUBMITTED:
      return "orange";
    case RoomRequestStatus.MORE_INFORMATION_NEEDED:
      return "yellow";
    case RoomRequestStatus.CREATED:
    case RoomRequestStatus.EDITED:
      return "blue";
    default:
      return "black";
  }
};
