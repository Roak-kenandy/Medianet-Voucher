import { Users } from 'lucide-react';

export default function TrialBanner({
  trialActive,
  trialAccountsRemaining,
  trialAccountLimit,
  trialAccountsUsed,
}) {
  if (!trialActive || trialAccountsRemaining <= 0) return null;

  return (
    <div className="operator-alert-banner" style={{ marginBottom: 24 }}>
      <Users size={18} />
      <span>
        <strong>Free account trial:</strong> {trialAccountsRemaining} free account
        {trialAccountsRemaining === 1 ? '' : 's'} remaining ({trialAccountsUsed} of {trialAccountLimit}{' '}
        used). New accounts use free slots before wallet charges apply.
      </span>
    </div>
  );
}
