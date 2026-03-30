export interface Member {
  memberId: string;
  fullName: string;
  dateOfBirth: string;
}

export interface CreateMemberInput {
  fullName: string;
  dateOfBirth: string;
}
