import type { AssignmentObject } from '@/assets/types/datatypes';

/** A stored assignment placing each vendor named, one full table apiece on one day. */
export function assignmentPlacing(...emails: string[]): AssignmentObject {
  return {
    vendorAssignments: emails.map((email, index) => ({
      email,
      date: '2099-05-20',
      tableCode: `A${index + 1}`,
      tableChoice: 'Full table',
      section: 'A',
      tier: 'Standard',
      location: 'Hall',
    })),
    assignmentDate: '2099-05-01',
    totalVendorsAssigned: emails.length,
    totalTablesAssigned: emails.length,
    assignmentStatistics: null,
  };
}
