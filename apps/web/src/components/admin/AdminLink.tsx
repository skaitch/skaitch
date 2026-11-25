import { useEffect, useState } from 'react';
import { auth } from '../../lib/firebase';
import { isAdministrator } from '../../lib/adminClient';

/** "Administration" entry, shown only once the server confirms the administrator role. */
export default function AdminLink() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    const user = auth.currentUser;
    if (user) isAdministrator(user).then(ok => { if (active) setVisible(ok); });
    return () => { active = false; };
  }, []);
  if (!visible) return null;
  return <p style={{ margin: '0 0 12px' }}><a className="btn" href="/admin">Administration</a></p>;
}
