-- The manager's first entry through the school's own login link (no separate activation link): Google / Apple
-- sign-in can carry that purpose. Only the manager email recorded in the school file can complete it.
ALTER TABLE oauth_states DROP CONSTRAINT oauth_states_purpose_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_purpose_check CHECK (purpose IN ('login', 'setup', 'link', 'claim'));
