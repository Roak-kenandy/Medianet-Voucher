import './RoleSelector.css';

const ROLES = [
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full access to operators, packages, staff, and reports.',
  },
  {
    value: 'sales',
    label: 'Sales',
    description: 'Manage operators and packages. Cannot create staff accounts.',
  },
  {
    value: 'finance',
    label: 'Finance',
    description: 'View reports and operators. Cannot create packages.',
  },
];

export default function RoleSelector({ value, onChange, name = 'staff-role' }) {
  return (
    <div className="role-selector" role="radiogroup" aria-label="Staff role">
      {ROLES.map((role) => (
        <label
          key={role.value}
          className={`role-selector-item${value === role.value ? ' is-selected' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={role.value}
            checked={value === role.value}
            onChange={() => onChange(role.value)}
          />
          <span className="role-selector-item-body">
            <span className="role-selector-item-label">{role.label}</span>
            <span className="role-selector-item-desc">{role.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
