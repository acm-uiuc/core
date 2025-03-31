import { RoomRequestStatus } from '@common/types/roomRequest';
import { capitalizeFirstLetter } from '../events/ManageEvent.page';
import { IconGitBranch } from '@tabler/icons-react';

export const getStatusIcon = (status: RoomRequestStatus) => {
  return <IconGitBranch size={12} />;
};

export const formatStatus = (status: RoomRequestStatus) => {
  return capitalizeFirstLetter(status).replaceAll('_', ' ').replaceAll('uiuc', 'UIUC');
};
