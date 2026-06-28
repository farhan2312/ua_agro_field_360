/** Plain typed shapes passed from the server page into the client subcomponents. */

export interface UserRow {
  id: number;
  init: string;
  name: string;
  email: string;
  /** Display role label, e.g. "Agri Officer". */
  roleLabel: string;
  /** linear-gradient(...) string for the avatar. */
  grad: string;
  territory: string;
  lastActive: string;
  visitsMtd: string;
  /** "Active" | "Inactive" */
  status: string;
}

export interface StoreRow {
  id: number;
  name: string;
  /** Store accent colour (hex). */
  color: string;
  address: string;
  district: string;
  /** Agri Officer 1 full name (may be ""). */
  ao1: string;
  /** Agri Officer 2 full name (may be ""). */
  ao2: string;
  /** Count of mapped (demo) farmers. */
  farmerCount: number;
  /** Comma-joined mapped farmer names. */
  farmerNames: string;
}
