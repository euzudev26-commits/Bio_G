import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { getDatabaseErrorMessage } from '../lib/databaseError';
import './EmployeeManagement.css';

export type EmployeeRecord = {
  id: string;
  employee_code: string;
  full_name: string;
  biomax_user_id: string | null;
  department: string | null;
  designation: string | null;
  employment_status: string;
  email?: string | null;
  phone?: string | null;
  joined_on?: string | null;
  auth_user_id?: string | null;
};

export type EmployeeInput = {
  employee_code: string;
  full_name: string;
  biomax_user_id: string | null;
  department: string | null;
  designation: string | null;
  employment_status: 'active' | 'inactive' | 'on_leave' | 'separated';
  email: string | null;
  phone: string | null;
  joined_on: string | null;
};

type Props = {
  employees: EmployeeRecord[];
  saving: boolean;
  onSave: (id: string | null, value: EmployeeInput) => Promise<void>;
  onRefresh: () => void;
};

const statusLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const emptyForm = (): EmployeeInput => ({
  employee_code: '',
  full_name: '',
  biomax_user_id: '',
  department: '',
  designation: '',
  employment_status: 'active',
  email: '',
  phone: '',
  joined_on: '',
});

export default function EmployeeManagement({ employees, saving, onSave, onRefresh }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeInput>(emptyForm());
  const [formOpen, setFormOpen] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!formOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFormOpen(false);
        setLocalError('');
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [formOpen]);

  const departments = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.department).filter(Boolean) as string[])).sort(),
    [employees],
  );

  const visibleEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((employee) => {
      const textMatch = !term || [
        employee.full_name,
        employee.employee_code,
        employee.biomax_user_id ?? '',
        employee.department ?? '',
        employee.designation ?? '',
        employee.email ?? '',
        employee.phone ?? '',
      ].some((value) => value.toLowerCase().includes(term));
      const statusMatch = statusFilter === 'all' || employee.employment_status === statusFilter;
      const departmentMatch = departmentFilter === 'all' || employee.department === departmentFilter;
      return textMatch && statusMatch && departmentMatch;
    });
  }, [employees, search, statusFilter, departmentFilter]);

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setLocalError('');
    setFormOpen(true);
  }

  function startEdit(employee: EmployeeRecord) {
    setEditingId(employee.id);
    setForm({
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      biomax_user_id: employee.biomax_user_id ?? '',
      department: employee.department ?? '',
      designation: employee.designation ?? '',
      employment_status: employee.employment_status as EmployeeInput['employment_status'],
      email: employee.email ?? '',
      phone: employee.phone ?? '',
      joined_on: employee.joined_on ?? '',
    });
    setLocalError('');
    setFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = form.employee_code.trim().toUpperCase();
    const name = form.full_name.trim();
    const biomaxId = form.biomax_user_id?.trim() || null;

    if (!code || !name) {
      setLocalError('Employee code and full name are required.');
      return;
    }
    if (biomaxId === '0000') {
      setLocalError('BioMax ID 0000 is reserved for unassigned/system events and cannot be mapped to an employee.');
      return;
    }
    setLocalError('');
    try {
      await onSave(editingId, {
        employee_code: code,
        full_name: name,
        biomax_user_id: biomaxId,
        department: form.department?.trim() || null,
        designation: form.designation?.trim() || null,
        employment_status: form.employment_status,
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        joined_on: form.joined_on || null,
      });
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm());
    } catch (error) {
      setLocalError(getDatabaseErrorMessage(error, 'Employee could not be saved.'));
    }
  }

  const activeCount = employees.filter((employee) => employee.employment_status === 'active').length;
  const mappedCount = employees.filter((employee) => Boolean(employee.biomax_user_id)).length;
  const linkedAccounts = employees.filter((employee) => Boolean(employee.auth_user_id)).length;

  return (
    <div className="employee-management">
      <section className="module-heading">
        <div>
          <span className="module-kicker">PEOPLE & ACCESS</span>
          <h1>Employee management</h1>
          <p>Maintain employee profiles and connect each person to their BioMax user ID.</p>
        </div>
        <div className="module-heading-actions">
          <button className="secondary-button" type="button" onClick={onRefresh}>↻ Refresh</button>
          <button type="button" onClick={startAdd}>+ Add employee</button>
        </div>
      </section>

      <section className="employee-summary">
        <div><span>Total profiles</span><strong>{employees.length}</strong></div>
        <div><span>Active employees</span><strong>{activeCount}</strong></div>
        <div><span>BioMax IDs mapped</span><strong>{mappedCount}</strong></div>
        <div><span>Login accounts linked</span><strong>{linkedAccounts}</strong></div>
      </section>

      {formOpen && (
        <div
          className="employee-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFormOpen(false);
              setLocalError('');
            }
          }}
        >
          <form
            className="employee-editor employee-editor-modal panel"
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-editor-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
          <div className="employee-editor-heading">
            <div>
              <span className="module-kicker">{editingId ? 'UPDATE PROFILE' : 'NEW PROFILE'}</span>
              <h2 id="employee-editor-title">{editingId ? 'Edit employee' : 'Add employee'}</h2>
              <p>Employee master details only. Login provisioning is a separate controlled step.</p>
            </div>
            <button className="icon-close" type="button" onClick={() => { setFormOpen(false); setLocalError(''); }} aria-label="Close form">×</button>
          </div>
          <div className="employee-form-grid">
            <label>Employee code <b>*</b><input value={form.employee_code} onChange={(event) => setForm({ ...form, employee_code: event.target.value })} required maxLength={40} placeholder="e.g. GS-0001" /></label>
            <label>Full name <b>*</b><input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required maxLength={160} placeholder="Employee full name" /></label>
            <label>BioMax user ID<input value={form.biomax_user_id ?? ''} onChange={(event) => setForm({ ...form, biomax_user_id: event.target.value })} maxLength={80} placeholder="Device user ID" /><small>Must match the registered BioMax ID. The device sync supports user ID and display name; department, designation, contact details and joining date remain GSONS-only. BioMax ID or employment-status changes require manual review to protect biometric enrollment.</small></label>
            <label>Department<input value={form.department ?? ''} onChange={(event) => setForm({ ...form, department: event.target.value })} maxLength={100} placeholder="e.g. Production" /></label>
            <label>Designation<input value={form.designation ?? ''} onChange={(event) => setForm({ ...form, designation: event.target.value })} maxLength={100} placeholder="e.g. Operator" /></label>
            <label>Employment status<select value={form.employment_status} onChange={(event) => setForm({ ...form, employment_status: event.target.value as EmployeeInput['employment_status'] })}><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On leave</option><option value="separated">Separated</option></select></label>
            <label>Work email (contact)<input type="email" value={form.email ?? ''} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={254} placeholder="name@gsons.in" /></label>
            <label>Phone<input type="tel" value={form.phone ?? ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={30} placeholder="Contact number" /></label>
            <label>Joining date<input type="date" value={form.joined_on ?? ''} onChange={(event) => setForm({ ...form, joined_on: event.target.value })} /></label>
          </div>
          {localError && <div className="employee-form-error" role="alert" aria-live="polite">{localError}</div>}
          <div className="employee-editor-footer">
            <span className="module-footnote">Saving a profile does not create or grant a login account.</span>
            <div><button className="secondary-button" type="button" onClick={() => { setFormOpen(false); setLocalError(''); }}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create employee'}</button></div>
          </div>
          </form>
        </div>
      )}

      <section className="panel employee-list-panel">
        <div className="employee-list-toolbar">
          <label className="module-search">Search employees<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, code, BioMax ID, department..." /></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">Active</option><option value="all">All statuses</option><option value="inactive">Inactive</option><option value="on_leave">On leave</option><option value="separated">Separated</option></select></label>
          <label>Department<select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="all">All departments</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
          <span className="employee-result-count">{visibleEmployees.length} shown</span>
        </div>
        <div className="table-wrap employee-table-wrap">
          <table>
            <thead><tr><th>Employee</th><th>Employee code</th><th>BioMax user ID</th><th>Department / designation</th><th>Login account</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {visibleEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td><strong>{employee.full_name}</strong><small>{employee.email || employee.phone || 'Contact details not added'}</small></td>
                  <td>{employee.employee_code}</td>
                  <td>{employee.biomax_user_id ?? <span className="table-muted">Not mapped</span>}</td>
                  <td>{employee.department || '—'}<small>{employee.designation || 'Designation not set'}</small></td>
                  <td><span className={employee.auth_user_id ? 'account-chip account-linked' : 'account-chip'}>{employee.auth_user_id ? 'Linked' : 'Not provisioned'}</span></td>
                  <td><span className={'pill employee-state-' + employee.employment_status}>{statusLabel(employee.employment_status)}</span></td>
                  <td><button className="table-action" type="button" onClick={() => startEdit(employee)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleEmployees.length && <div className="module-empty">No employees match these filters.</div>}
        </div>
      </section>
    </div>
  );
}
