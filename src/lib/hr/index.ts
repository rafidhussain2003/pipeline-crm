// Phase 22 — public surface of the HR Core bounded context. HR is the MASTER
// employee directory: Attendance, Payroll and CRM resolve employees through
// the directory functions (keyed on the shared userId) rather than storing
// their own copies.
export { HRError, EMPLOYMENT_STATUSES, DOCUMENT_TYPES, ACTIVE_STATUSES, isValidDateStr } from "./types";
export type { EmploymentStatus, DocumentType } from "./types";

export { hasHRPermission } from "./permissions";
export type { HRPermission } from "./permissions";

export { ensureHRSetup, getHRSettings, updateHRSettings, nextEmployeeCode } from "./settings";
export { listDepartments, getDepartment, createDepartment, updateDepartment, deleteDepartment } from "./departments";
export { listDesignations, getDesignation, createDesignation, updateDesignation, deleteDesignation } from "./designations";
export { listEmploymentTypes, createEmploymentType, deleteEmploymentType } from "./employment-types";
export {
  getEmployee, getEmployeeByUser, listEmployees, createEmployee, updateEmployee, deleteEmployee, listUnprofiledUsers,
} from "./employees";
export type { CreateEmployeeInput, ListEmployeesOpts } from "./employees";
export { getOrgChart, getDirectReports, assertNoCycle } from "./organization";
export type { OrgNode } from "./organization";
export { listDocuments, addDocument, deleteDocument } from "./documents";
export { hrDashboard } from "./dashboard";

// THE integration seam other modules consume.
export { resolveEmployee, resolveEmployees, getEmployeeDirectory } from "./directory";
export type { DirectoryEntry } from "./directory";

// Report placeholders (architecture only — Phase 22 builds no reports).
export interface HRReportDef {
  key: string;
  label: string;
  implemented: boolean;
}
export const HR_REPORTS: readonly HRReportDef[] = [
  { key: "employee_directory", label: "Employee Directory", implemented: false },
  { key: "headcount", label: "Headcount", implemented: false },
  { key: "department_summary", label: "Department Summary", implemented: false },
  { key: "organization_reports", label: "Organization Reports", implemented: false },
] as const;

// The named service facade matching the spec's service list.
import * as employees from "./employees";
import * as departments from "./departments";
import * as designations from "./designations";
import * as organization from "./organization";
import * as documents from "./documents";
import * as directory from "./directory";

export const hrService = {
  EmployeeService: employees,
  DepartmentService: departments,
  DesignationService: designations,
  OrganizationService: organization,
  DocumentService: documents,
  Directory: directory,
};
