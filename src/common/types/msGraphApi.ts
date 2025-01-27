export interface UserProfileDataBase {
  userPrincipalName: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string;
  otherMails?: string[]
}

export interface UserProfileData extends UserProfileDataBase {
  discordUsername?: string;
}
