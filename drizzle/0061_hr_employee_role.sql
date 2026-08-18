-- HR Employee — an HR-workspace-only user type the admin creates in HR → HR
-- Team (name + email + temporary password). Logs in and runs the HR
-- workspace: employees, offer letters & agreements, documents, departments,
-- designations, org chart, reports. Never the CRM, Finance or Payroll.
--
-- One new value on the existing "role" enum. ALTER TYPE ... ADD VALUE runs
-- outside a transaction (the reconciling boot migrator executes statements
-- autocommit, so this is safe); IF NOT EXISTS makes it idempotent and the
-- migrator tolerates duplicate_object. Purely additive.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'hr_employee';
