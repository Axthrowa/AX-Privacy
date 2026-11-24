import { useEffect, useState } from 'react';
import { L } from '../shared/i18n.ts';
import { askPermissions, hasPermissions } from '../shared/permissions.ts';

/** Whether `perms` are granted, kept current when the user grants or removes them anywhere. */
export function useGranted(perms: chrome.permissions.Permissions): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => void hasPermissions(perms).then(setGranted);
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [perms]);
  return granted;
}

/** A note with a grant button, shown only while the permission is missing. */
export function PermissionNote({
  perms,
  why,
}: {
  perms: chrome.permissions.Permissions;
  why: string;
}) {
  const granted = useGranted(perms);
  if (granted !== false) return null;
  return (
    <p className="note">
      {why}{' '}
      <button type="button" onClick={() => void askPermissions(perms)}>
        {L('İzin ver', 'Allow')}
      </button>
    </p>
  );
}
