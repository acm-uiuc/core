import { RoomRequestStatus } from '@common/types/roomRequest';
import { capitalizeFirstLetter } from '../events/ManageEvent.page';
import {
  IconCircleCheck,
  IconCircleDashedCheck,
  IconExclamationCircle,
  IconProgressCheck,
  IconQuestionMark,
} from '@tabler/icons-react';

export const getStatusIcon = (status: RoomRequestStatus) => {
  const commonProps = { size: 20 };
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
    default:
      return <IconCircleDashedCheck {...commonProps} />;
  }
};

export const formatStatus = (status: RoomRequestStatus) => {
  if (status === RoomRequestStatus.SUBMITTED) {
    return 'Submitted to UIUC';
  }
  return capitalizeFirstLetter(status)
    .replaceAll('_', ' ')
    .replaceAll('uiuc', 'UIUC')
    .replaceAll('acm', 'ACM');
};

export const getStatusColor = (status: RoomRequestStatus) => {
  switch (status) {
    case RoomRequestStatus.APPROVED:
      return 'green';
    case RoomRequestStatus.REJECTED_BY_UIUC:
    case RoomRequestStatus.REJECTED_BY_ACM:
      return 'red';
    case RoomRequestStatus.SUBMITTED:
      return 'orange';
    case RoomRequestStatus.MORE_INFORMATION_NEEDED:
      return 'yellow';
    default:
      return 'black';
  }
};
