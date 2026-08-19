-- Backend Agent — a Sales-Ledger-only employee the admin creates in Sales →
-- Backend Agents (name + email + temporary password). Sees and works EVERY
-- sale on the master sheet (edit statuses/details), but has no delete/restore/
-- cutoff/export powers (admin-only) and no access to the CRM, Commercial
-- Sales, Finance, HR, Attendance, Payroll or Workflow. Purely additive.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'backend_agent';
